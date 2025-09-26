using Microsoft.EntityFrameworkCore;
using RandevuCore.Application.DTOs;
using RandevuCore.Domain.Entities;
using RandevuCore.Infrastructure.Persistence;

namespace RandevuCore.Infrastructure.Services
{
    public class MeetingService
    {
        private readonly RandevuDbContext _db;

        public MeetingService(RandevuDbContext db)
        {
            _db = db;
        }

        public async Task<List<MeetingListItemDto>> GetUserMeetingsAsync(Guid userId)
        {
            var list = await _db.Meetings
                .Where(m => m.CreatorId == userId || m.Invitees.Any(u => u.Id == userId))
                .ToListAsync();
            return list.Select(m => new MeetingListItemDto
            {
                Id = m.Id,
                Title = m.Title,
                StartsAt = m.StartsAt,
                EndsAt = m.EndsAt,
                Notes = m.Notes,
                Status = m.Status,
                CreatorId = m.CreatorId,
                VideoSessionId = m.VideoSessionId,
                WhiteboardSessionId = m.WhiteboardSessionId
            }).ToList();
        }

        public async Task<(bool Ok, string? Error, Guid? Id)> CreateAsync(Guid creatorId, MeetingCreateDto dto)
        {
            if (dto.StartsAt >= dto.EndsAt) return (false, "StartsAt must be before EndsAt", null);

            var invitees = await _db.Users.Where(u => dto.InviteeIds.Contains(u.Id)).ToListAsync();
            var meeting = new Meeting
            {
                Id = Guid.NewGuid(),
                Title = dto.Title,
                StartsAt = dto.StartsAt,
                EndsAt = dto.EndsAt,
                Notes = dto.Notes,
                CreatorId = creatorId,
                Invitees = invitees,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };
            await _db.Meetings.AddAsync(meeting);
            await _db.SaveChangesAsync();
            return (true, null, meeting.Id);
        }

        public async Task<(bool Ok, string? Error)> UpdateAsync(Guid id, Guid userId, MeetingUpdateDto dto)
        {
            var existing = await _db.Meetings.FindAsync(id);
            if (existing == null) return (false, "Not found");
            if (existing.CreatorId != userId) return (false, "Forbidden");
            if (dto.StartsAt >= dto.EndsAt) return (false, "StartsAt must be before EndsAt");

            existing.Title = dto.Title;
            existing.StartsAt = dto.StartsAt;
            existing.EndsAt = dto.EndsAt;
            existing.Notes = dto.Notes;
            existing.Status = dto.Status;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync();
            return (true, null);
        }

        public async Task<(bool Ok, string? Error)> DeleteAsync(Guid id, Guid userId)
        {
            var existing = await _db.Meetings.FindAsync(id);
            if (existing == null) return (false, "Not found");
            if (existing.CreatorId != userId) return (false, "Forbidden");
            _db.Meetings.Remove(existing);
            await _db.SaveChangesAsync();
            return (true, null);
        }
    }
}
