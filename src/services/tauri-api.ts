// Tauri API Service - Backend Communication

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type { 
  Contact, 
  NewContact, 
  UserFoundEvent, 
  IncomingCallEvent,
  RegisteredEvent,
  SignalingErrorEvent,
  CallRejectedEvent,
  CallState 
} from '../types';

// ============================================================================
// IDENTITY
// ============================================================================

export async function getPublicKey(): Promise<string> {
  return await invoke('get_public_key');
}

export async function getPeerId(): Promise<string | null> {
  return await invoke('get_peer_id');
}

export async function getUsername(): Promise<string | null> {
  return await invoke('get_username');
}

// ============================================================================
// SIGNALING
// ============================================================================

export async function connectAndRegister(username: string): Promise<string> {
  return await invoke('connect_and_register', { username });
}

export async function disconnect(): Promise<void> {
  return await invoke('disconnect');
}

export async function findUser(username: string): Promise<void> {
  return await invoke('find_user', { username });
}

// ============================================================================
// CONTACTS
// ============================================================================

export async function getContacts(): Promise<Contact[]> {
  return await invoke('get_contacts');
}

export async function addContact(contact: NewContact): Promise<Contact> {
  return await invoke('add_contact', { 
    peerId: contact.peer_id, 
    username: contact.username,
    displayName: contact.display_name 
  });
}

export async function deleteContact(peerId: string): Promise<void> {
  return await invoke('delete_contact', { peerId });
}

export async function updateContactName(peerId: string, displayName: string | null): Promise<void> {
  return await invoke('update_contact_name', { peerId, displayName });
}

// ============================================================================
// CALLS
// ============================================================================

export async function startCall(peerId: string): Promise<void> {
  return await invoke('start_call', { peerId });
}

export async function acceptCall(peerId: string, offerSdp: string): Promise<void> {
  return await invoke('accept_call', { peerId, offerSdp });
}

export async function rejectCall(peerId: string, reason?: string): Promise<void> {
  return await invoke('reject_call', { peerId, reason });
}

export async function hangup(): Promise<void> {
  return await invoke('hangup');
}

export async function getCallState(): Promise<CallState> {
  return await invoke('get_call_state') as CallState;
}

export async function setMuted(muted: boolean): Promise<void> {
  return await invoke('set_muted', { muted });
}

export async function isMuted(): Promise<boolean> {
  return await invoke('is_muted');
}

export async function getAudioLevels(): Promise<[number, number]> {
  return await invoke('get_audio_levels');
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

export type EventCallback<T> = (payload: T) => void;

// Signaling Events
export function onSignalingConnected(callback: EventCallback<null>): Promise<UnlistenFn> {
  return listen('signaling:connected', () => callback(null));
}

export function onSignalingDisconnected(callback: EventCallback<null>): Promise<UnlistenFn> {
  return listen('signaling:disconnected', () => callback(null));
}

export function onRegistered(callback: EventCallback<RegisteredEvent>): Promise<UnlistenFn> {
  return listen<RegisteredEvent>('signaling:registered', (event) => callback(event.payload));
}

export function onUserFound(callback: EventCallback<UserFoundEvent>): Promise<UnlistenFn> {
  return listen<UserFoundEvent>('signaling:user_found', (event) => callback(event.payload));
}

export function onUserNotFound(callback: EventCallback<string>): Promise<UnlistenFn> {
  return listen<string>('signaling:user_not_found', (event) => callback(event.payload));
}

export function onSignalingError(callback: EventCallback<SignalingErrorEvent>): Promise<UnlistenFn> {
  return listen<SignalingErrorEvent>('signaling:error', (event) => callback(event.payload));
}

// Call Events
export function onIncomingCall(callback: EventCallback<IncomingCallEvent>): Promise<UnlistenFn> {
  return listen<IncomingCallEvent>('call:incoming', (event) => callback(event.payload));
}

export function onAnswerReceived(callback: EventCallback<string>): Promise<UnlistenFn> {
  return listen<string>('call:answer_received', (event) => callback(event.payload));
}

export function onCallRejected(callback: EventCallback<CallRejectedEvent>): Promise<UnlistenFn> {
  return listen<CallRejectedEvent>('call:rejected', (event) => callback(event.payload));
}

export function onCallEnded(callback: EventCallback<string>): Promise<UnlistenFn> {
  return listen<string>('call:ended', (event) => callback(event.payload));
}

// Contact Events
export function onContactOnline(callback: EventCallback<string>): Promise<UnlistenFn> {
  return listen<string>('contact:online', (event) => callback(event.payload));
}

export function onContactOffline(callback: EventCallback<string>): Promise<UnlistenFn> {
  return listen<string>('contact:offline', (event) => callback(event.payload));
}
