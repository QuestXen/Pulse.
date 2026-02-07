// TypeScript Types für die P2P Voice Call App

export interface Contact {
  id: number;
  peer_id: string;
  username: string;
  display_name: string | null;
  is_online: boolean;
  created_at: string;
  last_seen: string | null;
}

export interface NewContact {
  peer_id: string;
  username: string;
  display_name?: string;
}

export interface UserFoundEvent {
  peer_id: string;
  username: string;
  is_online: boolean;
}

export interface IncomingCallEvent {
  fromPeerId: string;
  fromUsername: string;
  sdp: string;
}

export interface RegisteredEvent {
  peerId: string;
  username: string;
}

export interface SignalingErrorEvent {
  code: string;
  message: string;
}

export interface CallRejectedEvent {
  byPeerId: string;
  reason?: string;
}

export type CallState = 
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'ended';

export type AppScreen = 
  | 'login'
  | 'main'
  | 'call';
