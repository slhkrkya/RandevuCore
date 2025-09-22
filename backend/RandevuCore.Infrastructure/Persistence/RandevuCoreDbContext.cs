using Microsoft.EntityFrameworkCore;
using RandevuCore.Domain.Entities;

namespace RandevuCore.Infrastructure.Persistence
{
    public class RandevuCoreDbContext : DbContext
    {
        public RandevuCoreDbContext(DbContextOptions<RandevuCoreDbContext> options) 
            : base(options) { }

        public DbSet<User> Users { get; set; } = null!;
        public DbSet<Appointment> Appointments { get; set; } = null!;

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Appointment -> User relation
            modelBuilder.Entity<Appointment>()
                .HasOne(a => a.Creator)
                .WithMany()
                .HasForeignKey(a => a.CreatorId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<Appointment>()
                .HasOne(a => a.Invitee)
                .WithMany()
                .HasForeignKey(a => a.InviteeId)
                .OnDelete(DeleteBehavior.Restrict);
        }
    }
}
