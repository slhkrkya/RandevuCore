using Microsoft.EntityFrameworkCore;
using RandevuCore.Application.Interfaces;
using RandevuCore.Domain.Entities;
using RandevuCore.Infrastructure.Persistence;

namespace RandevuCore.Application.Services
{
    public class AppointmentService : IAppointmentService
    {
        private readonly RandevuCoreDbContext _context;

        public AppointmentService(RandevuCoreDbContext context)
        {
            _context = context;
        }

        public async Task<List<Appointment>> GetAllAppointmentsAsync(Guid userId)
        {
            return await _context.Appointments
                .Include(a => a.Creator)
                .Include(a => a.Invitee)
                .Where(a => a.CreatorId == userId || a.InviteeId == userId)
                .ToListAsync();
        }

        public async Task<Appointment?> GetAppointmentByIdAsync(Guid appointmentId, Guid userId)
        {
            return await _context.Appointments
                .Include(a => a.Creator)
                .Include(a => a.Invitee)
                .FirstOrDefaultAsync(a => a.Id == appointmentId && 
                    (a.CreatorId == userId || a.InviteeId == userId));
        }

        public async Task<Appointment> CreateAppointmentAsync(Appointment appointment)
        {
            if (await IsOverlappingAsync(appointment))
                throw new InvalidOperationException("Randevu çakışıyor!");

            _context.Appointments.Add(appointment);
            await _context.SaveChangesAsync();
            return appointment;
        }

        public async Task<Appointment> UpdateAppointmentAsync(Appointment appointment)
        {
            if (await IsOverlappingAsync(appointment))
                throw new InvalidOperationException("Randevu çakışıyor!");

            _context.Appointments.Update(appointment);
            await _context.SaveChangesAsync();
            return appointment;
        }

        public async Task<bool> DeleteAppointmentAsync(Guid appointmentId, Guid userId)
        {
            var appointment = await _context.Appointments
                .FirstOrDefaultAsync(a => a.Id == appointmentId && a.CreatorId == userId);

            if (appointment == null)
                return false;

            _context.Appointments.Remove(appointment);
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<bool> IsOverlappingAsync(Appointment appointment)
        {
            return await _context.Appointments.AnyAsync(a =>
                (a.CreatorId == appointment.CreatorId || a.InviteeId == appointment.InviteeId) &&
                a.Id != appointment.Id &&
                appointment.StartsAt < a.EndsAt &&
                appointment.EndsAt > a.StartsAt);
        }
    }
}