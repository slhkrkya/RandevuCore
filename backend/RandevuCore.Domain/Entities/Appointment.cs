using System;

namespace RandevuCore.Domain.Entities
{
    public enum AppointmentStatus { Scheduled, Canceled, Done }

    public class Appointment
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Title { get; set; } = null!;
        public DateTimeOffset StartsAt { get; set; }
        public DateTimeOffset EndsAt { get; set; }
        public AppointmentStatus Status { get; set; } = AppointmentStatus.Scheduled;
        public string? Notes { get; set; }

        public Guid CreatorId { get; set; }
        public User Creator { get; set; } = null!;

        public Guid InviteeId { get; set; }
        public User Invitee { get; set; } = null!;

        public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
        public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    }
}