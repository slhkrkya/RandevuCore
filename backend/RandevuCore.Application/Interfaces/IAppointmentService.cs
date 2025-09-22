using RandevuCore.Domain.Entities;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace RandevuCore.Application.Interfaces
{
    public interface IAppointmentService
    {
        Task<List<Appointment>> GetAllAppointmentsAsync(Guid userId);
        Task<Appointment?> GetAppointmentByIdAsync(Guid appointmentId, Guid userId);
        Task<Appointment> CreateAppointmentAsync(Appointment appointment);
        Task<Appointment> UpdateAppointmentAsync(Appointment appointment);
        Task<bool> DeleteAppointmentAsync(Guid appointmentId, Guid userId);
        Task<bool> IsOverlappingAsync(Appointment appointment);
    }
}