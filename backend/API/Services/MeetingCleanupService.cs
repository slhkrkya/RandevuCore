using RandevuCore.Infrastructure.Services;
using RandevuCore.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Hosting;

namespace RandevuCore.API.Services
{
    public class MeetingCleanupService : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<MeetingCleanupService> _logger;
        private readonly TimeSpan _cleanupInterval = TimeSpan.FromHours(1); // Her saat başı temizlik

        public MeetingCleanupService(IServiceProvider serviceProvider, ILogger<MeetingCleanupService> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("MeetingCleanupService started");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await CleanupExpiredMeetings();
                    await Task.Delay(_cleanupInterval, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // Expected when cancellation is requested
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error occurred during meeting cleanup");
                    // Wait a bit before retrying to avoid rapid failures
                    await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
                }
            }

            _logger.LogInformation("MeetingCleanupService stopped");
        }

        private async Task CleanupExpiredMeetings()
        {
            using var scope = _serviceProvider.CreateScope();
            var meetingService = scope.ServiceProvider.GetRequiredService<MeetingService>();
            var db = scope.ServiceProvider.GetRequiredService<RandevuDbContext>();

            try
            {
                // Get expired meetings before deletion
                var expiredMeetings = await db.Meetings
                    .Where(m => m.EndsAt.AddHours(1) < DateTimeOffset.UtcNow)
                    .Select(m => new { m.Id, m.Title })
                    .ToListAsync();

                var deletedCount = await meetingService.DeleteExpiredMeetingsAsync();
                
                if (deletedCount > 0)
                {
                    _logger.LogInformation("Cleaned up {Count} expired meetings", deletedCount);
                    
                    // Clean up associated files
                    await CleanupMeetingFiles(expiredMeetings.Select(m => m.Id).ToList());
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to cleanup expired meetings");
                throw;
            }
        }

        private Task CleanupMeetingFiles(List<Guid> meetingIds)
        {
            try
            {
                var environment = _serviceProvider.GetRequiredService<IWebHostEnvironment>();
                var uploadsPath = Path.Combine(environment.ContentRootPath, "uploads", "chat-files");
                
                var deletedFilesCount = 0;
                var deletedFoldersCount = 0;

                foreach (var meetingId in meetingIds)
                {
                    var roomId = $"meeting-{meetingId}";
                    var meetingFolderPath = Path.Combine(uploadsPath, roomId);
                    
                    if (Directory.Exists(meetingFolderPath))
                    {
                        try
                        {
                            // Count files before deletion
                            var files = Directory.GetFiles(meetingFolderPath, "*", SearchOption.AllDirectories);
                            deletedFilesCount += files.Length;
                            
                            // Delete the entire folder
                            Directory.Delete(meetingFolderPath, true);
                            deletedFoldersCount++;
                            
                            _logger.LogInformation("Deleted meeting files for {RoomId}: {FileCount} files", roomId, files.Length);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Failed to delete files for meeting {RoomId}", roomId);
                        }
                    }
                }

                if (deletedFilesCount > 0 || deletedFoldersCount > 0)
                {
                    _logger.LogInformation("File cleanup completed: {FileCount} files deleted from {FolderCount} folders", 
                        deletedFilesCount, deletedFoldersCount);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to cleanup meeting files");
            }
            
            return Task.CompletedTask;
        }
    }
}
