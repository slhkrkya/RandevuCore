namespace RandevuCore.Domain.Entities
{
    public class User
    {
        public Guid Id { get; set; }
        public string Email { get; set; } = null!;
        public string PasswordHash { get; set; } = null!;
        public string Name { get; set; } = null!;
        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset UpdatedAt { get; set; }

        public ICollection<Appointment> CreatedAppointments { get; set; } = new List<Appointment>();
        public ICollection<Appointment> InvitedAppointments { get; set; } = new List<Appointment>();
        public ICollection<Meeting> CreatedMeetings { get; set; } = new List<Meeting>();
        public ICollection<WhiteboardPermission> WhiteboardPermissions { get; set; } = new List<WhiteboardPermission>();
    }
}
