using RandevuCore.Domain.Enums;

namespace RandevuCore.Application.DTOs
{
    public class AppointmentCreateDto
    {
        public string Title { get; set; } = null!;
        public DateTimeOffset StartsAt { get; set; }
        public DateTimeOffset EndsAt { get; set; }
        public string? Notes { get; set; }
        public Guid InviteeId { get; set; }
    }

    public class AppointmentUpdateDto
    {
        public string Title { get; set; } = null!;
        public DateTimeOffset StartsAt { get; set; }
        public DateTimeOffset EndsAt { get; set; }
        public string? Notes { get; set; }
        public AppointmentStatus Status { get; set; }
    }

    public class AppointmentListItemDto
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = null!;
        public DateTimeOffset StartsAt { get; set; }
        public DateTimeOffset EndsAt { get; set; }
        public string? Notes { get; set; }
        public AppointmentStatus Status { get; set; }
        public Guid CreatorId { get; set; }
        public Guid InviteeId { get; set; }
    }
}


