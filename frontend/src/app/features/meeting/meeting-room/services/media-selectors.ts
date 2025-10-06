import { Participant, MeetingState } from '../meeting-room';

export function isVideoTrackLive(stream?: MediaStream | null): boolean {
  if (!stream) return false;
  const track = stream.getVideoTracks()[0];
  return !!(track && track.readyState === 'live' && !(track as any).muted);
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
  return !!(hasLive && (participant.isVideoOn || participant.isScreenSharing));
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


