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
                await BroadcastPresence(roomId, members);
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
                    await BroadcastPresence(roomId, members);
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
                    await BroadcastPresence(roomId, members);
                }
            }
            await base.OnDisconnectedAsync(exception);
        }

        private Task BroadcastPresence(string roomId, ConcurrentDictionary<string, Participant> members)
        {
            var list = members.Values.Select(p => new { connectionId = p.ConnectionId, userId = p.UserId, name = p.Name }).ToList();
            return Clients.Group(roomId).SendAsync("presence", list);
        }
    }
}


