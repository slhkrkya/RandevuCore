using RandevuCore.Application.DTOs;
using RandevuCore.Domain.Entities;
using RandevuCore.Domain.Interfaces;

namespace RandevuCore.Application.Services
{
    public class AppointmentService
    {
        private readonly IAppointmentRepository _repo;

        public AppointmentService(IAppointmentRepository repo)
        {
            _repo = repo;
        }

        public async Task<List<AppointmentListItemDto>> GetUserAppointmentsAsync(Guid userId)
        {
            var list = await _repo.GetUserAppointmentsAsync(userId);
            return list.Select(a => new AppointmentListItemDto
            {
                Id = a.Id,
                Title = a.Title,
                StartsAt = a.StartsAt,
                EndsAt = a.EndsAt,
                Notes = a.Notes,
                Status = a.Status,
                CreatorId = a.CreatorId,
                InviteeId = a.InviteeId
            }).ToList();
        }

        public async Task<(bool Ok, string? Error, Guid? Id)> CreateAsync(Guid creatorId, AppointmentCreateDto dto)
        {
            var now = DateTimeOffset.UtcNow;
            if (dto.StartsAt < now)
                return (false, "Randevu başlangıç zamanı geçmiş bir tarih olamaz", null);
            if (dto.StartsAt >= dto.EndsAt)
                return (false, "Başlangıç zamanı bitiş zamanından önce olmalıdır", null);

            var overlap = await _repo.CheckOverlapAsync(creatorId, dto.StartsAt, dto.EndsAt);
            if (overlap) return (false, "Bu zaman diliminde başka bir randevunuz bulunmaktadır", null);

            var appointment = new Appointment
            {
                Id = Guid.NewGuid(),
                Title = dto.Title,
                StartsAt = dto.StartsAt,
                EndsAt = dto.EndsAt,
                Notes = dto.Notes,
                CreatorId = creatorId,
                InviteeId = dto.InviteeId,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };

            await _repo.AddAsync(appointment);
            return (true, null, appointment.Id);
        }

        public async Task<(bool Ok, string? Error)> UpdateAsync(Guid id, Guid userId, AppointmentUpdateDto dto)
        {
            var existing = await _repo.GetByIdAsync(id);
            if (existing == null) return (false, "Randevu bulunamadı");
            if (existing.CreatorId != userId) return (false, "Bu randevuyu düzenleme yetkiniz bulunmamaktadır");
            
            var now = DateTimeOffset.UtcNow;
            if (dto.StartsAt < now) return (false, "Randevu başlangıç zamanı geçmiş bir tarih olamaz");
            if (dto.StartsAt >= dto.EndsAt) return (false, "Başlangıç zamanı bitiş zamanından önce olmalıdır");

            // Check overlap excluding self
            var hasOverlap = (await _repo.GetUserAppointmentsAsync(userId))
                .Any(a => a.Id != id && dto.StartsAt < a.EndsAt && dto.EndsAt > a.StartsAt);
            if (hasOverlap) return (false, "Bu zaman diliminde başka bir randevunuz bulunmaktadır");

            existing.Title = dto.Title;
            existing.StartsAt = dto.StartsAt;
            existing.EndsAt = dto.EndsAt;
            existing.Notes = dto.Notes;
            existing.Status = dto.Status;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
            await _repo.UpdateAsync(existing);
            return (true, null);
        }

        public async Task<(bool Ok, string? Error)> DeleteAsync(Guid id, Guid userId)
        {
            var existing = await _repo.GetByIdAsync(id);
            if (existing == null) return (false, "Randevu bulunamadı");
            if (existing.CreatorId != userId) return (false, "Bu randevuyu düzenleme yetkiniz bulunmamaktadır");
            await _repo.DeleteAsync(id);
            return (true, null);
        }
    }
}


