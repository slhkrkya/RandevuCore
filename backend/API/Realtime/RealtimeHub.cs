using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using RandevuCore.Infrastructure.Persistence;
using System.Collections.Concurrent;
using System.Security.Claims;

namespace RandevuCore.API.Realtime
{
    [Authorize]
    public class RealtimeHub : Hub
    {
        private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, Participant>> RoomIdToParticipants = new();
        private static readonly ConcurrentDictionary<string, string> ConnectionIdToRoom = new();
        private static readonly ConcurrentDictionary<string, DateTimeOffset> RoomStartTimes = new();
        private static readonly ConcurrentDictionary<string, Timer> RoomDurationTimers = new();
        private readonly RandevuDbContext _db;

        public RealtimeHub(RandevuDbContext db)
        {
            _db = db;
        }

        private (Guid userId, string name) GetUser()
        {
            var idStr = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? Context.User?.FindFirstValue("sub");
            var name = Context.User?.FindFirstValue("name") ?? "Unknown";
            return (Guid.Parse(idStr!), name);
        }

        private record Participant(string ConnectionId, Guid UserId, string Name);

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
                
                // Set room start time if this is the first participant
                if (members.Count == 1)
                {
                    // Reset start time and timer for new meeting session
                    RoomStartTimes[roomId] = DateTimeOffset.UtcNow;
                    await UpdateMeetingActualStartTime(roomId);
                    StartDurationTimer(roomId);
                }
                
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

        // Handle meeting state updates from clients
        public async Task BroadcastMeetingStateUpdate(string roomId, object stateData)
        {
            var (userId, _) = GetUser();
            await Clients.Group(roomId).SendAsync("meeting-state-update", new
            {
                userId = userId,
                state = stateData
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

                // Stop all timers and clear room data
                StopDurationTimer(roomId);
                RoomStartTimes.TryRemove(roomId, out _);
                RoomIdToParticipants.TryRemove(roomId, out _);
                
                // Notify all participants that meeting has ended
                await Clients.Group(roomId).SendAsync("meeting-ended");
            }
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
    }
}


