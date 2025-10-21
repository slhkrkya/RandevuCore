using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using RandevuCore.Infrastructure.Persistence;
using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Hosting;

namespace RandevuCore.API.Realtime
{
    [Authorize]
    public class RealtimeHub : Hub
    {
        private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, Participant>> RoomIdToParticipants = new();
        private static readonly ConcurrentDictionary<string, string> ConnectionIdToRoom = new();
        private static readonly ConcurrentDictionary<string, DateTimeOffset> RoomStartTimes = new();
        private static readonly ConcurrentDictionary<string, Timer> RoomDurationTimers = new();
        
        // NEW: Server-side authoritative state store
        private static readonly ConcurrentDictionary<string, ConcurrentDictionary<Guid, ParticipantState>> RoomParticipantStates = new();
        
        // Room end times for TTL-based cleanup
        private static readonly ConcurrentDictionary<string, DateTimeOffset> RoomEndTimes = new();
        
        // Chat messages storage (in-memory, per room)
        private static readonly ConcurrentDictionary<string, ConcurrentQueue<ChatMessageDto>> RoomChatMessages = new();
        private static readonly ConcurrentDictionary<string, DateTimeOffset> RoomChatStartTimes = new();
        
        // File messages storage (in-memory, per room)
        private static readonly ConcurrentDictionary<string, ConcurrentQueue<FileMessageDto>> RoomFileMessages = new();
        
        private readonly RandevuDbContext _db;
        private readonly IWebHostEnvironment _environment;

        public RealtimeHub(RandevuDbContext db, IWebHostEnvironment environment)
        {
            _db = db;
            _environment = environment;
        }

        private (Guid userId, string name) GetUser()
        {
            var idStr = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? Context.User?.FindFirstValue("sub");
            var name = Context.User?.FindFirstValue("name") ?? "Unknown";
            return (Guid.Parse(idStr!), name);
        }

        private record Participant(string ConnectionId, Guid UserId, string Name);
        
        // NEW: Participant state model with versioning
        private class ParticipantState
        {
            public Guid UserId { get; set; }
            public bool IsVideoOn { get; set; }
            public bool IsScreenSharing { get; set; }
            public bool IsMuted { get; set; }
            public bool WasVideoOnBeforeShare { get; set; } // For screen share state persistence
            public long Version { get; set; } // Monotonic version number
            public DateTimeOffset LastUpdatedUtc { get; set; }
            
            public ParticipantState()
            {
                Version = 0;
                LastUpdatedUtc = DateTimeOffset.UtcNow;
            }
        }

        public override async Task OnConnectedAsync()
        {
            await base.OnConnectedAsync();
        }

        public async Task JoinRoom(string roomId)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
            // If this is a meeting room, track presence
            if (roomId.StartsWith("meeting-"))
            {
                var (uid, name) = GetUser();
                var members = RoomIdToParticipants.GetOrAdd(roomId, _ => new());
                members[Context.ConnectionId] = new Participant(Context.ConnectionId, uid, name);
                ConnectionIdToRoom[Context.ConnectionId] = roomId;
                
                // Check if room was recently ended (TTL check)
                if (RoomEndTimes.TryGetValue(roomId, out var endTime))
                {
                    var elapsed = DateTimeOffset.UtcNow - endTime;
                    // If room ended less than 30 seconds ago, clear old state for fresh start
                    if (elapsed.TotalSeconds < 30)
                    {
                        RoomParticipantStates.TryRemove(roomId, out _);
                        RoomEndTimes.TryRemove(roomId, out _);
                    }
                }
                
                // Set room start time if this is the first participant
                if (members.Count == 1)
                {
                    // Reset start time and timer for new meeting session
                    RoomStartTimes[roomId] = DateTimeOffset.UtcNow;
                    await UpdateMeetingActualStartTime(roomId);
                    StartDurationTimer(roomId);
                }
                
                // NEW: Send initial state snapshot to the joining user
                var states = RoomParticipantStates.GetOrAdd(roomId, _ => new ConcurrentDictionary<Guid, ParticipantState>());
                var stateSnapshot = states.Values.Select(s => new
                {
                    userId = s.UserId,
                    isVideoOn = s.IsVideoOn,
                    isScreenSharing = s.IsScreenSharing,
                    isMuted = s.IsMuted,
                    wasVideoOnBeforeShare = s.WasVideoOnBeforeShare,
                    version = s.Version,
                    timestamp = s.LastUpdatedUtc
                }).ToList();
                
                // Send initial state only to the caller (newly joined user)
                await Clients.Caller.SendAsync("initial-participant-states", stateSnapshot);
                
                // Send chat history to newly joined user
                await GetChatHistory(roomId);
                
                // Send file history to newly joined user
                await GetFileHistory(roomId);
                
                await BroadcastPresence(roomId, members);
                await BroadcastMeetingDuration(roomId);
            }
        }

        public async Task LeaveRoom(string roomId)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
            if (roomId.StartsWith("meeting-"))
            {
                if (RoomIdToParticipants.TryGetValue(roomId, out var members))
                {
                    members.TryRemove(Context.ConnectionId, out _);
                    
                    // Stop duration timer if no participants left
                    if (members.Count == 0)
                    {
                        StopDurationTimer(roomId);
                        RoomStartTimes.TryRemove(roomId, out _);
                    }
                    
                    try
                    {
                        await BroadcastPresence(roomId, members);
                    }
                    catch (ObjectDisposedException)
                    {
                        // Hub is disposed, ignore
                    }
                }
                ConnectionIdToRoom.TryRemove(Context.ConnectionId, out _);
            }
        }

        public Task BroadcastEvent(string eventName, object payload)
        {
            return Clients.All.SendAsync(eventName, payload);
        }

        public Task SendToRoom(string roomId, string eventName, object payload)
        {
            // Add fromUserId to payload for WebRTC signaling
            var (userId, _) = GetUser();
            var payloadWithSender = new { fromUserId = userId, payload = payload };
            return Clients.Group(roomId).SendAsync(eventName, payloadWithSender);
        }

        public async Task GrantPermission(string roomId, Guid targetUserId, string permission)
        {
            // Only meeting owner can grant
            if (!roomId.StartsWith("meeting-")) return;
            var (callerId, _) = GetUser();
            var meetingIdStr = roomId[8..];
            if (!Guid.TryParse(meetingIdStr, out var meetingId)) return;
            var meeting = await _db.Meetings.FindAsync(meetingId);
            if (meeting == null || meeting.CreatorId != callerId) return;
            await Clients.Group(roomId).SendAsync("perm-granted", new { targetUserId, permission });
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            if (ConnectionIdToRoom.TryRemove(Context.ConnectionId, out var roomId))
            {
                if (RoomIdToParticipants.TryGetValue(roomId, out var members))
                {
                    members.TryRemove(Context.ConnectionId, out _);
                    
                    // Stop duration timer if no participants left
                    if (members.Count == 0)
                    {
                        StopDurationTimer(roomId);
                        RoomStartTimes.TryRemove(roomId, out _);
                    }
                    
                    try
                    {
                        await BroadcastPresence(roomId, members);
                    }
                    catch (ObjectDisposedException)
                    {
                        // Hub is disposed, ignore
                    }
                }
            }
            await base.OnDisconnectedAsync(exception);
        }

        private Task BroadcastPresence(string roomId, ConcurrentDictionary<string, Participant> members)
        {
            var list = members.Values.Select(p => new { connectionId = p.ConnectionId, userId = p.UserId, name = p.Name }).ToList();
            return Clients.Group(roomId).SendAsync("presence", list);
        }

        private async Task UpdateMeetingActualStartTime(string roomId)
        {
            var meetingIdStr = roomId[8..]; // Remove "meeting-" prefix
            if (Guid.TryParse(meetingIdStr, out var meetingId))
            {
                var meeting = await _db.Meetings.FindAsync(meetingId);
                if (meeting != null)
                {
                    // Always update ActualStartTime for new meeting sessions
                    meeting.ActualStartTime = DateTimeOffset.UtcNow;
                    await _db.SaveChangesAsync();
                }
            }
        }

        private async Task BroadcastMeetingDuration(string roomId)
        {
            try
            {
                if (RoomStartTimes.TryGetValue(roomId, out var startTime))
                {
                    var duration = DateTimeOffset.UtcNow - startTime;
                    var durationString = $"{duration.Hours:D2}:{duration.Minutes:D2}:{duration.Seconds:D2}";
                    await Clients.Group(roomId).SendAsync("meeting-duration", durationString);
                }
            }
            catch (ObjectDisposedException)
            {
                // Hub is disposed, stop the timer for this room
                StopDurationTimer(roomId);
            }
        }

        public async Task GetMeetingDuration(string roomId)
        {
            await BroadcastMeetingDuration(roomId);
        }

        // NEW: Authoritative state update - client sends state, server stores & broadcasts with version
        public async Task UpdateParticipantState(string roomId, ParticipantStateDto dto)
        {
            if (!roomId.StartsWith("meeting-")) return;
            
            var (userId, _) = GetUser();
            var states = RoomParticipantStates.GetOrAdd(roomId, _ => new ConcurrentDictionary<Guid, ParticipantState>());
            
            // Get or create participant state
            var state = states.GetOrAdd(userId, _ => new ParticipantState { UserId = userId });
            
            // Update state fields
            state.IsVideoOn = dto.IsVideoOn;
            state.IsScreenSharing = dto.IsScreenSharing;
            state.IsMuted = dto.IsMuted;
            
            // Handle screen share persistence
            if (dto.WasVideoOnBeforeShare.HasValue)
            {
                state.WasVideoOnBeforeShare = dto.WasVideoOnBeforeShare.Value;
            }
            
            // Increment version (monotonic)
            state.Version++;
            state.LastUpdatedUtc = DateTimeOffset.UtcNow;
            
            // Broadcast to all participants in the room
            await Clients.Group(roomId).SendAsync("participant-state-updated", new
            {
                userId = userId,
                isVideoOn = state.IsVideoOn,
                isScreenSharing = state.IsScreenSharing,
                isMuted = state.IsMuted,
                wasVideoOnBeforeShare = state.WasVideoOnBeforeShare,
                version = state.Version,
                timestamp = state.LastUpdatedUtc
            });
        }
        
        // NEW: Notify when WebRTC track is ready (track arrival confirmation)
        public async Task NotifyTrackReady(string roomId, TrackReadyDto dto)
        {
            if (!roomId.StartsWith("meeting-")) return;
            
            var (userId, _) = GetUser();
            
            // Broadcast track-ready event to all participants
            await Clients.Group(roomId).SendAsync("participant-track-ready", new
            {
                userId = dto.ParticipantUserId ?? userId,
                hasVideo = dto.HasVideo,
                hasAudio = dto.HasAudio,
                timestamp = DateTimeOffset.UtcNow
            });
        }
        
        // DEPRECATED but kept for backward compatibility - use UpdateParticipantState instead
        [Obsolete("Use UpdateParticipantState for versioned state management")]
        public async Task BroadcastMeetingStateUpdate(string roomId, object stateData)
        {
            var (userId, _) = GetUser();
            await Clients.Group(roomId).SendAsync("meeting-state-update", new
            {
                userId = userId,
                state = stateData
            });
        }
        
        // Helper DTOs for typed communication
        public class ParticipantStateDto
        {
            public bool IsVideoOn { get; set; }
            public bool IsScreenSharing { get; set; }
            public bool IsMuted { get; set; }
            public bool? WasVideoOnBeforeShare { get; set; }
        }
        
        public class TrackReadyDto
        {
            public Guid? ParticipantUserId { get; set; }
            public bool HasVideo { get; set; }
            public bool HasAudio { get; set; }
        }
        
        // NEW: WebRTC Signaling DTOs
        public class WebRtcOfferDto
        {
            public Guid TargetUserId { get; set; }
            public object? Offer { get; set; } // RTCSessionDescriptionInit
        }
        
        public class WebRtcAnswerDto
        {
            public Guid TargetUserId { get; set; }
            public object? Answer { get; set; } // RTCSessionDescriptionInit
        }
        
        public class WebRtcIceCandidateDto
        {
            public Guid TargetUserId { get; set; }
            public object? Candidate { get; set; } // RTCIceCandidateInit
        }
        
        // Chat message DTO
        public class ChatMessageDto
        {
            public string Id { get; set; } = string.Empty;
            public Guid UserId { get; set; }
            public string UserName { get; set; } = string.Empty;
            public string Message { get; set; } = string.Empty;
            public DateTimeOffset Timestamp { get; set; }
        }

        // File message DTO
        public class FileMessageDto
        {
            public string Id { get; set; } = string.Empty;
            public Guid UserId { get; set; }
            public string UserName { get; set; } = string.Empty;
            public string OriginalFileName { get; set; } = string.Empty;
            public string FileName { get; set; } = string.Empty;
            public long FileSize { get; set; }
            public string FileType { get; set; } = string.Empty;
            public string UploadPath { get; set; } = string.Empty;
            public DateTimeOffset Timestamp { get; set; }
        }

        // NEW: WebRTC Signaling Methods for direct offer/answer/ICE communication
        public async Task SendOffer(string roomId, WebRtcOfferDto dto)
        {
            if (!roomId.StartsWith("meeting-")) return;
            
            var (fromUserId, _) = GetUser();
            
            // Send offer to specific target user
            await Clients.Group(roomId).SendAsync("webrtc-offer", new
            {
                fromUserId = fromUserId,
                targetUserId = dto.TargetUserId,
                offer = dto.Offer,
                timestamp = DateTimeOffset.UtcNow
            });
        }
        
        public async Task SendAnswer(string roomId, WebRtcAnswerDto dto)
        {
            if (!roomId.StartsWith("meeting-")) return;
            
            var (fromUserId, _) = GetUser();
            
            // Send answer to specific target user
            await Clients.Group(roomId).SendAsync("webrtc-answer", new
            {
                fromUserId = fromUserId,
                targetUserId = dto.TargetUserId,
                answer = dto.Answer,
                timestamp = DateTimeOffset.UtcNow
            });
        }
        
        public async Task SendIceCandidate(string roomId, WebRtcIceCandidateDto dto)
        {
            if (!roomId.StartsWith("meeting-")) return;
            
            var (fromUserId, _) = GetUser();
            
            // Send ICE candidate to specific target user
            await Clients.Group(roomId).SendAsync("webrtc-ice", new
            {
                fromUserId = fromUserId,
                targetUserId = dto.TargetUserId,
                candidate = dto.Candidate,
                timestamp = DateTimeOffset.UtcNow
            });
        }

        public async Task EndMeeting(string roomId)
        {
            if (roomId.StartsWith("meeting-"))
            {
                // Only meeting creator can end the meeting
                var (callerId, _) = GetUser();
                var meetingIdStr = roomId[8..]; // Remove "meeting-" prefix
                if (Guid.TryParse(meetingIdStr, out var meetingId))
                {
                    var meeting = await _db.Meetings.FindAsync(meetingId);
                    if (meeting == null || meeting.CreatorId != callerId) 
                    {
                        return; // Not authorized to end meeting
                    }
                }

                // Stop all timers
                StopDurationTimer(roomId);
                RoomStartTimes.TryRemove(roomId, out _);
                
                // NEW: Mark room end time for TTL-based cleanup (instead of immediate removal)
                // This allows graceful handling if users rejoin immediately
                RoomEndTimes[roomId] = DateTimeOffset.UtcNow;
                
                // Clear participant list (but keep state for TTL period)
                RoomIdToParticipants.TryRemove(roomId, out _);
                
                // Clear chat messages when meeting ends
                RoomChatMessages.TryRemove(roomId, out _);
                RoomChatStartTimes.TryRemove(roomId, out _);
                
                // Clear file messages when meeting ends
                RoomFileMessages.TryRemove(roomId, out _);
                
                // Clean up meeting files immediately when meeting ends
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await CleanupMeetingFiles(roomId);
                    }
                    catch (Exception ex)
                    {
                        // Log error but don't fail the meeting end process
                        Console.WriteLine($"Failed to cleanup files for room {roomId}: {ex.Message}");
                    }
                });
                
                // Schedule state cleanup after TTL (30 seconds)
                _ = Task.Run(async () =>
                {
                    await Task.Delay(TimeSpan.FromSeconds(30));
                    // Clean up old state if room is still marked as ended
                    if (RoomEndTimes.TryGetValue(roomId, out var endTime))
                    {
                        var elapsed = DateTimeOffset.UtcNow - endTime;
                        if (elapsed.TotalSeconds >= 30)
                        {
                            RoomParticipantStates.TryRemove(roomId, out _);
                            RoomEndTimes.TryRemove(roomId, out _);
                        }
                    }
                });
                
                // Notify all participants that meeting has ended
                await Clients.Group(roomId).SendAsync("meeting-ended");
            }
        }

        // Chat methods
        public async Task SendChatMessage(string roomId, string message)
        {
            if (!roomId.StartsWith("meeting-")) return;
            if (string.IsNullOrWhiteSpace(message)) return;

            var (userId, userName) = GetUser();
            
            // Create chat message
            var chatMessage = new ChatMessageDto
            {
                Id = Guid.NewGuid().ToString(),
                UserId = userId,
                UserName = userName,
                Message = message.Trim(),
                Timestamp = DateTimeOffset.UtcNow
            };

            // Store message in room's chat history
            var roomMessages = RoomChatMessages.GetOrAdd(roomId, _ => new ConcurrentQueue<ChatMessageDto>());
            roomMessages.Enqueue(chatMessage);

            // Set chat start time if this is the first message
            if (!RoomChatStartTimes.ContainsKey(roomId))
            {
                RoomChatStartTimes[roomId] = DateTimeOffset.UtcNow;
            }

            // Broadcast message to all participants in the room
            await Clients.Group(roomId).SendAsync("chat-message", chatMessage);
        }

        public async Task GetChatHistory(string roomId)
        {
            if (!roomId.StartsWith("meeting-")) return;

            var (userId, _) = GetUser();
            
            // Get chat start time for this room
            if (!RoomChatStartTimes.TryGetValue(roomId, out var chatStartTime))
            {
                // No chat history yet
                await Clients.Caller.SendAsync("chat-history", new List<ChatMessageDto>());
                return;
            }

            // Get messages from room's chat history
            var roomMessages = RoomChatMessages.GetOrAdd(roomId, _ => new ConcurrentQueue<ChatMessageDto>());
            var messages = roomMessages.ToList();

            // Send chat history to the caller (newly joined user)
            await Clients.Caller.SendAsync("chat-history", messages);
        }

        // File sharing methods
        public async Task SendFileMessage(string roomId, FileMessageDto fileMessage)
        {
            if (!roomId.StartsWith("meeting-")) return;

            var (userId, userName) = GetUser();
            
            // Create file message
            var fileMsg = new FileMessageDto
            {
                Id = fileMessage.Id,
                UserId = userId,
                UserName = userName,
                OriginalFileName = fileMessage.OriginalFileName,
                FileName = fileMessage.FileName,
                FileSize = fileMessage.FileSize,
                FileType = fileMessage.FileType,
                UploadPath = fileMessage.UploadPath,
                Timestamp = DateTimeOffset.UtcNow
            };

            // Store file message in room's file history
            var roomFileMessages = RoomFileMessages.GetOrAdd(roomId, _ => new ConcurrentQueue<FileMessageDto>());
            roomFileMessages.Enqueue(fileMsg);

            // Broadcast file message to all participants in the room
            await Clients.Group(roomId).SendAsync("file-message", fileMsg);
        }

        public async Task GetFileHistory(string roomId)
        {
            if (!roomId.StartsWith("meeting-")) return;

            var (userId, _) = GetUser();
            
            // Get file messages from room's file history
            var roomFileMessages = RoomFileMessages.GetOrAdd(roomId, _ => new ConcurrentQueue<FileMessageDto>());
            var fileMessages = roomFileMessages.ToList();

            // Send file history to the caller (newly joined user)
            await Clients.Caller.SendAsync("file-history", fileMessages);
        }

        private Task CleanupMeetingFiles(string roomId)
        {
            try
            {
                var uploadsPath = Path.Combine(_environment.ContentRootPath, "uploads", "chat-files");
                var meetingFolderPath = Path.Combine(uploadsPath, roomId);
                
                if (Directory.Exists(meetingFolderPath))
                {
                    // Count files before deletion
                    var files = Directory.GetFiles(meetingFolderPath, "*", SearchOption.AllDirectories);
                    
                    // Delete the entire folder
                    Directory.Delete(meetingFolderPath, true);
                    
                    Console.WriteLine($"Cleaned up meeting files for {roomId}: {files.Length} files deleted");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Failed to cleanup files for room {roomId}: {ex.Message}");
            }
            
            return Task.CompletedTask;
        }

        private void StartDurationTimer(string roomId)
        {
            // Stop existing timer if any
            StopDurationTimer(roomId);
            
            // Start new timer with error handling
            var timer = new Timer(async _ => 
            {
                try
                {
                    await BroadcastMeetingDuration(roomId);
                }
                catch (Exception ex)
                {
                    // Log error and stop timer if hub is disposed
                    if (ex is ObjectDisposedException)
                    {
                        StopDurationTimer(roomId);
                    }
                }
            }, null, TimeSpan.Zero, TimeSpan.FromSeconds(1));
            
            RoomDurationTimers[roomId] = timer;
        }

        private void StopDurationTimer(string roomId)
        {
            if (RoomDurationTimers.TryRemove(roomId, out var timer))
            {
                timer.Dispose();
            }
        }

        public async Task ClearChat(string roomId)
        {
            try
            {
                // Chat geçmişini temizle (memory'den)
                if (RoomChatMessages.ContainsKey(roomId))
                {
                    RoomChatMessages[roomId].Clear();
                }
                
                if (RoomFileMessages.ContainsKey(roomId))
                {
                    RoomFileMessages[roomId].Clear();
                }

                // Tüm katılımcılara chat temizlendi sinyali gönder
                await Clients.Group(roomId).SendAsync("chat-cleared", new { roomId });
                
                Console.WriteLine($"Chat cleared for room: {roomId}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error clearing chat for room {roomId}: {ex.Message}");
            }
        }

        // Whiteboard document management methods
        public async Task UploadWhiteboardDocument(string roomId, FileMessageDto fileMessage)
        {
            if (!roomId.StartsWith("meeting-")) return;

            var (userId, userName) = GetUser();
            
            // Create file message
            var fileMsg = new FileMessageDto
            {
                Id = fileMessage.Id,
                UserId = userId,
                UserName = userName,
                OriginalFileName = fileMessage.OriginalFileName,
                FileName = fileMessage.FileName,
                FileSize = fileMessage.FileSize,
                FileType = fileMessage.FileType,
                UploadPath = fileMessage.UploadPath,
                Timestamp = DateTimeOffset.UtcNow
            };

            // Broadcast document upload to all participants in the room
            await Clients.Group(roomId).SendAsync("whiteboard-document-uploaded", fileMsg);
        }

        public async Task RemoveWhiteboardDocument(string roomId)
        {
            if (!roomId.StartsWith("meeting-")) return;

            // Only meeting creator can remove documents
            var (callerId, _) = GetUser();
            var meetingIdStr = roomId[8..]; // Remove "meeting-" prefix
            if (Guid.TryParse(meetingIdStr, out var meetingId))
            {
                var meeting = await _db.Meetings.FindAsync(meetingId);
                if (meeting == null || meeting.CreatorId != callerId) 
                {
                    return; // Not authorized to remove document
                }
            }

            // Broadcast document removal to all participants in the room
            await Clients.Group(roomId).SendAsync("whiteboard-document-removed", new { roomId });
        }

        // Whiteboard permission request method
        public async Task RequestWhiteboardPermission(string roomId, string requesterId, string requesterName)
        {
            if (!roomId.StartsWith("meeting-")) return;

            // Get meeting creator (host)
            var meetingIdStr = roomId[8..]; // Remove "meeting-" prefix
            if (Guid.TryParse(meetingIdStr, out var meetingId))
            {
                var meeting = await _db.Meetings.FindAsync(meetingId);
                if (meeting != null)
                {
                    // Find host's connection ID
                    var hostConnectionId = RoomIdToParticipants[roomId]
                        .Values
                        .FirstOrDefault(p => p.UserId == meeting.CreatorId)?.ConnectionId;

                    if (hostConnectionId != null)
                    {
                        // Send permission request to host only
                        await Clients.Client(hostConnectionId).SendAsync("whiteboard-permission-request", new
                        {
                            requesterId = requesterId,
                            requesterName = requesterName,
                            roomId = roomId
                        });
                    }
                }
            }
        }

        // Grant whiteboard permission to all participants
        public async Task GrantWhiteboardPermission(string roomId, string targetUserId)
        {
            if (!roomId.StartsWith("meeting-")) return;

            // Get meeting creator (host)
            var meetingIdStr = roomId[8..]; // Remove "meeting-" prefix
            if (Guid.TryParse(meetingIdStr, out var meetingId))
            {
                var meeting = await _db.Meetings.FindAsync(meetingId);
                if (meeting != null)
                {
                    // Find host's connection ID
                    var hostConnectionId = RoomIdToParticipants[roomId]
                        .Values
                        .FirstOrDefault(p => p.UserId == meeting.CreatorId)?.ConnectionId;

                    if (hostConnectionId != null)
                    {
                        // Broadcast permission to all participants
                        await Clients.Group(roomId).SendAsync("whiteboard-permission", new
                        {
                            targetUserId = targetUserId,
                            canDraw = true,
                            grantedBy = "host"
                        });
                    }
                }
            }
        }
    }
}

