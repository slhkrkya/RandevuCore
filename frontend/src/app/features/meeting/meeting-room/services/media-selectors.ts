import { Participant, MeetingState } from '../meeting-room';

export function isVideoTrackLive(stream?: MediaStream | null): boolean {
  if (!stream) return false;
  const track = stream.getVideoTracks()[0];
  // Check: track exists, is live, enabled, and not muted
  return !!(track && track.readyState === 'live' && track.enabled && !track.muted);
}

export function isParticipantVideoVisible(
  participant: Participant,
  currentUserId: string,
  meetingState: MeetingState,
  localStream?: MediaStream,
  remoteStreams: Map<string, MediaStream> = new Map()
): boolean {
  // ✅ FIXED: Correct video visibility logic
  
  if (participant.userId === currentUserId) {
    // For current user: show video if meeting state says video is on AND we have a stream
    const shouldShow = meetingState.isVideoOn || meetingState.isScreenSharing;
    if (!shouldShow) return false;
    
    const hasStream = !!localStream && localStream.getVideoTracks().length > 0;
    return hasStream; // Show if we have video track (regardless of live state)
  }
  
  // For remote participants: show video if participant state says video is on AND we have a LIVE video track
  const shouldShow = participant.isVideoOn || participant.isScreenSharing;
  if (!shouldShow) return false; // ← This is CORRECT: if video is off, don't show video
  
  const remoteStream = remoteStreams.get(participant.userId);
  const hasStream = !!remoteStream && isVideoTrackLive(remoteStream);
  
  return hasStream; // Show if we have video track (regardless of live state)
}

export function getStreamForParticipant(
  participant: Participant,
  currentUserId: string,
  meetingState: MeetingState,
  localStream?: MediaStream,
  remoteStreams: Map<string, MediaStream> = new Map()
): MediaStream | undefined {
  if (participant.userId === currentUserId) {
    return isParticipantVideoVisible(participant, currentUserId, meetingState, localStream, remoteStreams)
      ? localStream
      : undefined;
  }
  const remote = remoteStreams.get(participant.userId);
  return isParticipantVideoVisible(participant, currentUserId, meetingState, localStream, remoteStreams)
    ? remote
    : undefined;
}

export function selectActiveSpeaker(
  participants: Participant[],
  currentUserId: string,
  meetingState: MeetingState,
  localStream?: MediaStream,
  remoteStreams: Map<string, MediaStream> = new Map()
): Participant | null {
  if (!participants || participants.length === 0) return null;

  // 1) Screen sharing participants first
  const screenSharers = participants.filter(p => p.isScreenSharing);
  if (screenSharers.length > 0) return screenSharers[0];

  // 2) Video visible + active speaker id matches
  const videoSpeaking = participants.filter(p =>
    isParticipantVideoVisible(p, currentUserId, meetingState, localStream, remoteStreams) &&
    p.userId === meetingState.activeSpeaker
  );
  if (videoSpeaking.length > 0) return videoSpeaking[0];

  // 3) Any video visible
  const videoVisible = participants.filter(p =>
    isParticipantVideoVisible(p, currentUserId, meetingState, localStream, remoteStreams)
  );
  if (videoVisible.length > 0) return videoVisible[0];

  // 4) Active speaker id even if no video
  if (meetingState.activeSpeaker) {
    const s = participants.find(p => p.userId === meetingState.activeSpeaker);
    if (s) return s;
  }

  // 5) Default to first
  return participants[0];
}

// ✅ NEW: Video loading state check
export function isParticipantVideoLoading(
  participant: Participant,
  currentUserId: string,
  localStream?: MediaStream,
  remoteStreams: Map<string, MediaStream> = new Map()
): boolean {
  // Prefer showing avatar instead of loading at all states
  return false;
}

