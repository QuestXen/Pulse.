//! Audio Handler - Mikrofon Capture und Playback
//!
//! Verwendet cpal für Cross-Platform Audio I/O.
//! Opus-Encoding kann später hinzugefügt werden wenn vcpkg konfiguriert ist.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig, SupportedStreamConfigRange};
use parking_lot::Mutex;
use ringbuf::{traits::*, HeapRb};
use std::sync::Arc;
use thiserror::Error;

// ============================================================================
// CONSTANTS
// ============================================================================

/// Sample Rate (48kHz ist der Standard für beste Qualität)
pub const SAMPLE_RATE: u32 = 48000;

/// Channels (Mono für Voice)
pub const CHANNELS: u16 = 1;

/// Frame Size in Samples (20ms @ 48kHz = 960 samples)
pub const FRAME_SIZE: usize = 960;

/// Buffer Size für Audio-Ring-Buffer
const RING_BUFFER_SIZE: usize = FRAME_SIZE * 10;

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum AudioError {
    #[error("No audio input device found")]
    NoInputDevice,

    #[error("No audio output device found")]
    NoOutputDevice,

    #[error("Unsupported audio configuration: {0}")]
    UnsupportedConfig(String),

    #[error("Failed to build audio stream: {0}")]
    StreamBuildError(String),

    #[error("Failed to start audio stream: {0}")]
    StreamPlayError(String),
}

// ============================================================================
// AUDIO HANDLER
// ============================================================================

/// Handler für Audio Input/Output
///
/// Note: Stream ist nicht Send, daher wrappen wir in Send-fähige Container
pub struct AudioHandler {
    input_device: Option<Device>,
    output_device: Option<Device>,
    // Streams werden in Option gehalten und können bei stop() gedroppt werden
    input_stream: Option<Stream>,
    output_stream: Option<Stream>,

    /// Ring-Buffer für aufgenommenes Audio (Raw PCM)
    capture_buffer: Arc<Mutex<HeapRb<f32>>>,

    /// Ring-Buffer für zu spielendes Audio (decoded PCM)
    playback_buffer: Arc<Mutex<HeapRb<f32>>>,

    /// Mute-Status
    is_muted: Arc<Mutex<bool>>,

    /// Audio Level (0.0 - 1.0) für Visualisierung
    input_level: Arc<Mutex<f32>>,
    output_level: Arc<Mutex<f32>>,
}

// AudioHandler ist nicht automatisch Send wegen Stream
// Wir müssen die Streams daher separat verwalten
unsafe impl Send for AudioHandler {}

impl AudioHandler {
    /// Erstellt einen neuen AudioHandler
    pub fn new() -> Result<Self, AudioError> {
        let host = cpal::default_host();

        let input_device = host.default_input_device();
        let output_device = host.default_output_device();

        if input_device.is_none() {
            tracing::warn!("No audio input device found");
        }
        if output_device.is_none() {
            tracing::warn!("No audio output device found");
        }

        let capture_buffer = Arc::new(Mutex::new(HeapRb::new(RING_BUFFER_SIZE)));
        let playback_buffer = Arc::new(Mutex::new(HeapRb::new(RING_BUFFER_SIZE)));

        tracing::info!(
            "AudioHandler initialized: {}Hz, {} channel(s)",
            SAMPLE_RATE,
            CHANNELS
        );

        Ok(Self {
            input_device,
            output_device,
            input_stream: None,
            output_stream: None,
            capture_buffer,
            playback_buffer,
            is_muted: Arc::new(Mutex::new(false)),
            input_level: Arc::new(Mutex::new(0.0)),
            output_level: Arc::new(Mutex::new(0.0)),
        })
    }

    /// Startet Audio Capture (Mikrofon)
    pub fn start_capture(&mut self) -> Result<(), AudioError> {
        let device = self
            .input_device
            .as_ref()
            .ok_or(AudioError::NoInputDevice)?;

        // Beste Konfiguration finden
        let config = Self::find_best_input_config(device)?;

        tracing::info!(
            "Starting audio capture: {} Hz, {} channels",
            config.sample_rate.0,
            config.channels
        );

        let capture_buffer = Arc::clone(&self.capture_buffer);
        let is_muted = Arc::clone(&self.is_muted);
        let input_level = Arc::clone(&self.input_level);
        let target_sample_rate = SAMPLE_RATE;
        let source_sample_rate = config.sample_rate.0;

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let muted = *is_muted.lock();

                    // Audio Level berechnen (RMS)
                    let rms: f32 =
                        (data.iter().map(|s| s * s).sum::<f32>() / data.len() as f32).sqrt();
                    *input_level.lock() = rms.min(1.0);

                    if muted {
                        return;
                    }

                    // Resampling falls nötig (zu 48kHz)
                    let samples: Vec<f32> = if source_sample_rate != target_sample_rate {
                        // Einfaches Linear-Resampling
                        let ratio = target_sample_rate as f32 / source_sample_rate as f32;
                        let new_len = (data.len() as f32 * ratio) as usize;
                        (0..new_len)
                            .map(|i| {
                                let src_idx = i as f32 / ratio;
                                let idx = src_idx as usize;
                                let frac = src_idx - idx as f32;
                                let s1 = data.get(idx).copied().unwrap_or(0.0);
                                let s2 = data.get(idx + 1).copied().unwrap_or(s1);
                                s1 + (s2 - s1) * frac
                            })
                            .collect()
                    } else {
                        data.to_vec()
                    };

                    // In Ring-Buffer schreiben
                    let mut buffer = capture_buffer.lock();
                    for sample in samples {
                        let _ = buffer.try_push(sample);
                    }
                },
                |err| {
                    tracing::error!("Audio capture error: {}", err);
                },
                None,
            )
            .map_err(|e| AudioError::StreamBuildError(e.to_string()))?;

        stream
            .play()
            .map_err(|e| AudioError::StreamPlayError(e.to_string()))?;

        self.input_stream = Some(stream);
        Ok(())
    }

    /// Startet Audio Playback (Lautsprecher)
    pub fn start_playback(&mut self) -> Result<(), AudioError> {
        let device = self
            .output_device
            .as_ref()
            .ok_or(AudioError::NoOutputDevice)?;

        let config = Self::find_best_output_config(device)?;

        tracing::info!(
            "Starting audio playback: {} Hz, {} channels",
            config.sample_rate.0,
            config.channels
        );

        let playback_buffer = Arc::clone(&self.playback_buffer);
        let output_level = Arc::clone(&self.output_level);
        let source_sample_rate = SAMPLE_RATE;
        let target_sample_rate = config.sample_rate.0;
        let channels = config.channels as usize;

        let stream = device
            .build_output_stream(
                &config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    let mut buffer = playback_buffer.lock();
                    let mut level_sum = 0.0f32;
                    let mut sample_count = 0;

                    // Mono zu Stereo (falls nötig) und Resampling
                    let samples_needed = data.len() / channels;
                    let ratio = source_sample_rate as f32 / target_sample_rate as f32;
                    let source_samples_needed = (samples_needed as f32 * ratio) as usize;

                    for i in 0..samples_needed {
                        // Source index berechnen
                        let src_idx = (i as f32 * ratio) as usize;

                        // Sample aus Buffer lesen
                        let sample = if src_idx < source_samples_needed {
                            buffer.try_pop().unwrap_or(0.0)
                        } else {
                            0.0
                        };

                        level_sum += sample.abs();
                        sample_count += 1;

                        // Auf alle Kanäle verteilen
                        for c in 0..channels {
                            if let Some(s) = data.get_mut(i * channels + c) {
                                *s = sample;
                            }
                        }
                    }

                    // Level aktualisieren
                    if sample_count > 0 {
                        *output_level.lock() = (level_sum / sample_count as f32).min(1.0);
                    }
                },
                |err| {
                    tracing::error!("Audio playback error: {}", err);
                },
                None,
            )
            .map_err(|e| AudioError::StreamBuildError(e.to_string()))?;

        stream
            .play()
            .map_err(|e| AudioError::StreamPlayError(e.to_string()))?;

        self.output_stream = Some(stream);
        Ok(())
    }

    /// Stoppt alle Audio-Streams
    pub fn stop(&mut self) {
        self.input_stream = None;
        self.output_stream = None;
        tracing::info!("Audio streams stopped");
    }

    /// Liest einen Frame von aufgenommenem Audio
    pub fn read_frame(&self) -> Option<Vec<f32>> {
        let mut buffer = self.capture_buffer.lock();
        if buffer.occupied_len() >= FRAME_SIZE {
            let mut frame = Vec::with_capacity(FRAME_SIZE);
            for _ in 0..FRAME_SIZE {
                if let Some(sample) = buffer.try_pop() {
                    frame.push(sample);
                }
            }
            Some(frame)
        } else {
            None
        }
    }

    /// Schreibt Audio-Samples in den Playback-Buffer
    pub fn write_samples(&self, samples: &[f32]) {
        let mut buffer = self.playback_buffer.lock();
        for sample in samples {
            let _ = buffer.try_push(*sample);
        }
    }

    /// Setzt den Mute-Status
    pub fn set_muted(&self, muted: bool) {
        *self.is_muted.lock() = muted;
        tracing::debug!("Audio muted: {}", muted);
    }

    /// Gibt den Mute-Status zurück
    pub fn is_muted(&self) -> bool {
        *self.is_muted.lock()
    }

    /// Gibt die Audio-Levels zurück (input, output)
    pub fn get_levels(&self) -> (f32, f32) {
        (*self.input_level.lock(), *self.output_level.lock())
    }

    /// Findet die beste Input-Konfiguration
    fn find_best_input_config(device: &Device) -> Result<StreamConfig, AudioError> {
        let configs = device
            .supported_input_configs()
            .map_err(|e| AudioError::UnsupportedConfig(e.to_string()))?;

        Self::select_best_config(configs.collect())
    }

    /// Findet die beste Output-Konfiguration
    fn find_best_output_config(device: &Device) -> Result<StreamConfig, AudioError> {
        let configs = device
            .supported_output_configs()
            .map_err(|e| AudioError::UnsupportedConfig(e.to_string()))?;

        Self::select_best_config(configs.collect())
    }

    /// Wählt die beste Konfiguration aus einer Liste
    fn select_best_config(
        configs: Vec<SupportedStreamConfigRange>,
    ) -> Result<StreamConfig, AudioError> {
        // Priorität: 48kHz > 44.1kHz > andere, F32 > I16 > andere
        let target_rate = cpal::SampleRate(SAMPLE_RATE);

        // Versuche exakt 48kHz zu finden
        for config in &configs {
            if config.min_sample_rate() <= target_rate
                && config.max_sample_rate() >= target_rate
                && config.sample_format() == SampleFormat::F32
            {
                return Ok(config.with_sample_rate(target_rate).into());
            }
        }

        // Fallback auf beste verfügbare Konfiguration
        for config in &configs {
            if config.sample_format() == SampleFormat::F32 {
                let rate = if config.min_sample_rate() <= target_rate
                    && config.max_sample_rate() >= target_rate
                {
                    target_rate
                } else {
                    config.max_sample_rate()
                };
                return Ok(config.with_sample_rate(rate).into());
            }
        }

        // Nehme erste verfügbare Konfiguration
        if let Some(config) = configs.first() {
            return Ok(config.with_max_sample_rate().into());
        }

        Err(AudioError::UnsupportedConfig(
            "No suitable audio configuration found".to_string(),
        ))
    }
}

impl Default for AudioHandler {
    fn default() -> Self {
        Self::new().expect("Failed to create AudioHandler")
    }
}
