using RandevuCore.Domain.Enums;

namespace RandevuCore.Domain.Entities
{
    public class Appointment
    {
        public Guid Id { get; set; }
        public string Title { get; set; }
        public DateTimeOffset StartsAt { get; set; }
        public DateTimeOffset EndsAt { get; set; }
        public AppointmentStatus Status { get; set; } = AppointmentStatus.Scheduled;
        public string Notes { get; set; }
        public Guid CreatorId { get; set; }
        public Guid InviteeId { get; set; }
    }
}