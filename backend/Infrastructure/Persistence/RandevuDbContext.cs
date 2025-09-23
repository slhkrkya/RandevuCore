using Microsoft.EntityFrameworkCore;
using RandevuCore.Domain.Entities;

namespace RandevuCore.Infrastructure.Persistence
{
    public class RandevuDbContext : DbContext
    {
        public RandevuDbContext(DbContextOptions<RandevuDbContext> options) : base(options) { }

        public DbSet<User> Users => Set<User>();
        public DbSet<Appointment> Appointments => Set<Appointment>();
        public DbSet<Meeting> Meetings => Set<Meeting>();
        public DbSet<WhiteboardPermission> WhiteboardPermissions => Set<WhiteboardPermission>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Appointment ilişkileri
            modelBuilder.Entity<Appointment>()
                .HasOne(a => a.Creator)
                .WithMany(u => u.CreatedAppointments)
                .HasForeignKey(a => a.CreatorId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<Appointment>()
                .HasOne(a => a.Invitee)
                .WithMany(u => u.InvitedAppointments)
                .HasForeignKey(a => a.InviteeId)
                .OnDelete(DeleteBehavior.Restrict);

            // Meeting.Creator 1:N ilişkisi
            modelBuilder.Entity<Meeting>()
                .HasOne(m => m.Creator)
                .WithMany(u => u.CreatedMeetings)
                .HasForeignKey(m => m.CreatorId)
                .OnDelete(DeleteBehavior.Restrict);

            // Meeting - User (Invitees) N:N ilişkisi (inverse navigation yok)
            modelBuilder.Entity<Meeting>()
                .HasMany(m => m.Invitees)
                .WithMany();

            // WhiteboardPermission ilişkileri
            modelBuilder.Entity<WhiteboardPermission>()
                .HasOne(w => w.Meeting)
                .WithMany(m => m.WhiteboardPermissions)
                .HasForeignKey(w => w.MeetingId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<WhiteboardPermission>()
                .HasOne(w => w.User)
                .WithMany(u => u.WhiteboardPermissions)
                .HasForeignKey(w => w.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // Indexler
            modelBuilder.Entity<Appointment>()
                .HasIndex(a => new { a.CreatorId, a.StartsAt });

            modelBuilder.Entity<Appointment>()
                .HasIndex(a => new { a.InviteeId, a.StartsAt });
        }
    }
}