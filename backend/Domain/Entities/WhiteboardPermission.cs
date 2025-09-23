namespace RandevuCore.Domain.Entities
{
    public class WhiteboardPermission
    {
        public Guid Id { get; set; }
        public Guid MeetingId { get; set; }
        public Meeting Meeting { get; set; } = null!;

        public Guid UserId { get; set; }
        public User User { get; set; } = null!;

        public bool CanDraw { get; set; } = false;
    }
}