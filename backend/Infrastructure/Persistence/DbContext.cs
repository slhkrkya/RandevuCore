using Microsoft.EntityFrameworkCore;
using RandevuCore.Domain.Entities;

namespace RandevuCore.Infrastructure.Persistence
{
    public class RandevuDbContext : DbContext
    {
        public RandevuDbContext(DbContextOptions<RandevuDbContext> options) : base(options)
        {
        }

        public DbSet<Appointment> Appointments { get; set; }
    }
}

