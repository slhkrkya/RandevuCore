using Microsoft.EntityFrameworkCore;
using RandevuCore.Domain.Entities;
using RandevuCore.Domain.Interfaces;
using RandevuCore.Infrastructure.Persistence;

namespace RandevuCore.Infrastructure.Repositories
{
    public class AppointmentRepository : IAppointmentRepository
    {
        private readonly RandevuDbContext _context;

        public AppointmentRepository(RandevuDbContext context)
        {
            _context = context;
        }

        public async Task AddAsync(Appointment appointment)
        {
            await _context.Appointments.AddAsync(appointment);
            await _context.SaveChangesAsync();
        }

        public async Task DeleteAsync(Guid id)
        {
            var entity = await _context.Appointments.FindAsync(id);
            if (entity != null)
            {
                _context.Appointments.Remove(entity);
                await _context.SaveChangesAsync();
            }
        }

        public async Task<Appointment?> GetByIdAsync(Guid id)
        {
            return await _context.Appointments.FindAsync(id);
        }

        public async Task<List<Appointment>> GetUserAppointmentsAsync(Guid userId)
        {
            return await _context.Appointments
                .Where(a => a.CreatorId == userId || a.InviteeId == userId)
                .ToListAsync();
        }

        public async Task UpdateAsync(Appointment appointment)
        {
            _context.Appointments.Update(appointment);
            await _context.SaveChangesAsync();
        }

        public async Task<bool> CheckOverlapAsync(Guid userId, DateTimeOffset start, DateTimeOffset end)
        {
            return await _context.Appointments.AnyAsync(a =>
                (a.CreatorId == userId || a.InviteeId == userId) &&
                start < a.EndsAt && end > a.StartsAt
            );
        }
    }
}