using RandevuCore.Domain.Enums;

namespace RandevuCore.Application.DTOs
{
    public class MeetingCreateDto
    {
        public string Title { get; set; } = null!;
        public DateTimeOffset StartsAt { get; set; }
        public DateTimeOffset EndsAt { get; set; }
        public string? Notes { get; set; }
        public List<Guid> InviteeIds { get; set; } = new();
    }

    public class MeetingUpdateDto
    {
        public string Title { get; set; } = null!;
        public DateTimeOffset StartsAt { get; set; }
        public DateTimeOffset EndsAt { get; set; }
        public string? Notes { get; set; }
        public AppointmentStatus Status { get; set; }
    }

    public class MeetingListItemDto
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = null!;
        public DateTimeOffset StartsAt { get; set; }
        public DateTimeOffset EndsAt { get; set; }
        public string? Notes { get; set; }
        public AppointmentStatus Status { get; set; }
        public Guid CreatorId { get; set; }
        public string? VideoSessionId { get; set; }
        public string? WhiteboardSessionId { get; set; }
    }
}


