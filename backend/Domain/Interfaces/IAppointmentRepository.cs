using RandevuCore.Domain.Entities;

namespace RandevuCore.Domain.Interfaces
{
    public interface IAppointmentRepository
    {
        Task<Appointment?> GetByIdAsync(Guid id);
        Task<List<Appointment>> GetUserAppointmentsAsync(Guid userId);
        Task AddAsync(Appointment appointment);
        Task UpdateAsync(Appointment appointment);
        Task DeleteAsync(Guid id);
        Task<bool> CheckOverlapAsync(Guid userId, DateTimeOffset start, DateTimeOffset end);
    }
}