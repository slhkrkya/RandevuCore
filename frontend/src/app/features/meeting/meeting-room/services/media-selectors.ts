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
  if (participant.userId === currentUserId) {
    const hasLive = isVideoTrackLive(localStream);
    return !!(hasLive && (meetingState.isVideoOn || meetingState.isScreenSharing));
  }
  
  const remoteStream = remoteStreams.get(participant.userId);
  const hasLive = isVideoTrackLive(remoteStream);
  
  // ✅ ENHANCED: More lenient video visibility check for late joiner scenarios
  // If participant says video is on, show it even if track is not fully live yet
  const shouldShow = participant.isVideoOn || participant.isScreenSharing;
  const hasStream = !!remoteStream && remoteStream.getVideoTracks().length > 0;
  const hasVideoTrack = hasStream && remoteStream!.getVideoTracks()[0];
  
  // ✅ ENHANCED: Show video if:
  // 1. Track is live and participant has video on, OR
  // 2. Participant has video on and we have a stream (even if not fully live yet), OR
  // 3. Participant has video on and we have a video track (even if not live), OR
  // 4. Participant has video on (for late joiner scenarios where stream might not be ready yet)
  // 5. ✅ NEW: Always show if participant state says video is on (for rejoin scenarios)
  // 6. ✅ FIXED: For rejoin scenarios, be more aggressive about showing video
  const isRejoinScenario = shouldShow && !hasStream && !hasVideoTrack;
  
  return !!(hasLive && shouldShow) || 
         !!(hasStream && shouldShow) || 
         !!(hasVideoTrack && shouldShow) || 
         shouldShow ||
         isRejoinScenario;
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
  // Check if participant has video on but track hasn't arrived yet
  if (!participant.isVideoOn) return false;
  
  const stream = participant.userId === currentUserId 
    ? localStream 
    : remoteStreams.get(participant.userId);
    
  if (!stream) return true; // Video is on but no stream yet
  
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return true; // Video is on but no track yet
  
  return !isVideoTrackLive(stream); // Track exists but not live yet
}

