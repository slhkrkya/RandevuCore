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
        public List<Guid> InviteeIds { get; set; } = new();
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
        public string CreatorName { get; set; } = null!;
        public string? VideoSessionId { get; set; }
        public string? WhiteboardSessionId { get; set; }
        public List<MeetingInviteeDto> Invitees { get; set; } = new();
        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset UpdatedAt { get; set; }
    }

    public class MeetingInviteeDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = null!;
        public string Email { get; set; } = null!;
    }
}


