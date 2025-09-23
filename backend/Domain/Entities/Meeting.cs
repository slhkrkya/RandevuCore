using RandevuCore.Domain.Enums;

namespace RandevuCore.Domain.Entities
{
    public class Meeting
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = null!;
        public DateTimeOffset StartsAt { get; set; }
        public DateTimeOffset EndsAt { get; set; }
        public string? Notes { get; set; }
        public string? VideoSessionId { get; set; }
        public string? WhiteboardSessionId { get; set; }
        public AppointmentStatus Status { get; set; } = AppointmentStatus.Scheduled;

        public Guid CreatorId { get; set; }
        public User Creator { get; set; } = null!;

        public ICollection<User> Invitees { get; set; } = new List<User>();
        public ICollection<WhiteboardPermission> WhiteboardPermissions { get; set; } = new List<WhiteboardPermission>();

        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset UpdatedAt { get; set; }
    }
}