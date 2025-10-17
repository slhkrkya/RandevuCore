using Microsoft.EntityFrameworkCore;
using RandevuCore.Application.DTOs;
using RandevuCore.Domain.Entities;
using RandevuCore.Infrastructure.Persistence;
using System.Collections.Concurrent;

namespace RandevuCore.Infrastructure.Services
{
    public class MeetingService
    {
        private readonly RandevuDbContext _db;
        private static readonly ConcurrentDictionary<string, (List<MeetingListItemDto> Data, DateTime Expiry)> _cache = new();

        public MeetingService(RandevuDbContext db)
        {
            _db = db;
        }

        public async Task<List<MeetingListItemDto>> GetUserMeetingsAsync(Guid userId, Guid? filterByUserId = null)
        {
            // Cache key oluştur
            var cacheKey = $"meetings_{userId}_{filterByUserId}";
            
            // Cache kontrolü
            if (_cache.TryGetValue(cacheKey, out var cached) && cached.Expiry > DateTime.UtcNow)
            {
                return cached.Data;
            }

            // Önce kullanıcının erişebileceği toplantı ID'lerini bul
            var accessibleMeetingIds = await _db.Meetings
                .Where(m => m.CreatorId == userId)
                .Select(m => m.Id)
                .Union(
                    _db.Meetings
                        .Where(m => m.Invitees.Any(u => u.Id == userId))
                        .Select(m => m.Id)
                )
                .ToListAsync();

            // Filtreleme varsa ek filtreleme yap
            if (filterByUserId.HasValue)
            {
                var filteredMeetingIds = await _db.Meetings
                    .Where(m => m.CreatorId == filterByUserId.Value)
                    .Select(m => m.Id)
                    .Union(
                        _db.Meetings
                            .Where(m => m.Invitees.Any(u => u.Id == filterByUserId.Value))
                            .Select(m => m.Id)
                    )
                    .ToListAsync();

                accessibleMeetingIds = accessibleMeetingIds.Intersect(filteredMeetingIds).ToList();
            }

            // Sadece erişilebilir toplantıları çek (Include ile invitee bilgilerini de al)
            var meetings = await _db.Meetings
                .Include(m => m.Invitees)
                .Where(m => accessibleMeetingIds.Contains(m.Id))
                .OrderBy(m => m.StartsAt)
                .ToListAsync();

            var result = meetings.Select(m => new MeetingListItemDto
            {
                Id = m.Id,
                Title = m.Title,
                StartsAt = m.StartsAt,
                EndsAt = m.EndsAt,
                Notes = m.Notes,
                Status = m.Status,
                CreatorId = m.CreatorId,
                VideoSessionId = m.VideoSessionId,
                WhiteboardSessionId = m.WhiteboardSessionId,
                Invitees = m.Invitees.Select(i => new MeetingInviteeDto
                {
                    Id = i.Id,
                    Name = i.Name,
                    Email = i.Email
                }).ToList(),
                CreatedAt = m.CreatedAt,
                UpdatedAt = m.UpdatedAt
            }).ToList();

            // Cache'e kaydet (2 dakika)
            _cache.TryAdd(cacheKey, (result, DateTime.UtcNow.AddMinutes(2)));

            return result;
        }

        public async Task<(bool Ok, string? Error, Guid? Id)> CreateAsync(Guid creatorId, MeetingCreateDto dto)
        {
            var now = DateTimeOffset.UtcNow;
            if (dto.StartsAt < now) return (false, "Toplantı başlangıç zamanı geçmiş bir tarih olamaz", null);
            if (dto.StartsAt >= dto.EndsAt) return (false, "Başlangıç zamanı bitiş zamanından önce olmalıdır", null);

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
            
            // Cache'i temizle
            ClearCache();
            
            return (true, null, meeting.Id);
        }

        public async Task<(bool Ok, string? Error)> UpdateAsync(Guid id, Guid userId, MeetingUpdateDto dto)
        {
            var existing = await _db.Meetings.FindAsync(id);
            if (existing == null) return (false, "Toplantı bulunamadı");
            if (existing.CreatorId != userId) return (false, "Bu toplantıyı düzenleme yetkiniz bulunmamaktadır");
            
            var now = DateTimeOffset.UtcNow;
            if (dto.StartsAt < now) return (false, "Toplantı başlangıç zamanı geçmiş bir tarih olamaz");
            if (dto.StartsAt >= dto.EndsAt) return (false, "Başlangıç zamanı bitiş zamanından önce olmalıdır");

            existing.Title = dto.Title;
            existing.StartsAt = dto.StartsAt;
            existing.EndsAt = dto.EndsAt;
            existing.Notes = dto.Notes;
            existing.Status = dto.Status;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync();
            
            // Cache'i temizle
            ClearCache();
            
            return (true, null);
        }

        public async Task<(bool Ok, string? Error)> DeleteAsync(Guid id, Guid userId)
        {
            var existing = await _db.Meetings.FindAsync(id);
            if (existing == null) return (false, "Toplantı bulunamadı");
            if (existing.CreatorId != userId) return (false, "Bu toplantıyı düzenleme yetkiniz bulunmamaktadır");
            _db.Meetings.Remove(existing);
            await _db.SaveChangesAsync();
            
            // Cache'i temizle
            ClearCache();
            
            return (true, null);
        }

        public async Task<int> DeleteExpiredMeetingsAsync()
        {
            var now = DateTimeOffset.UtcNow;
            var expiredMeetings = await _db.Meetings
                .Where(m => m.EndsAt.AddHours(1) < now)
                .ToListAsync();
            
            if (expiredMeetings.Any())
            {
                _db.Meetings.RemoveRange(expiredMeetings);
                await _db.SaveChangesAsync();
                
                // Cache'i temizle
                ClearCache();
            }
            
            return expiredMeetings.Count;
        }

        private static void ClearCache()
        {
            _cache.Clear();
        }
    }
}
