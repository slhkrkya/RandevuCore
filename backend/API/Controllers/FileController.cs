using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using RandevuCore.Infrastructure.Persistence;

namespace RandevuCore.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class FileController : ControllerBase
    {
        private readonly IWebHostEnvironment _environment;
        private readonly ILogger<FileController> _logger;
        private readonly RandevuDbContext _db;

        public FileController(IWebHostEnvironment environment, ILogger<FileController> logger, RandevuDbContext db)
        {
            _environment = environment;
            _logger = logger;
            _db = db;
        }

        [HttpPost("upload")]
        public async Task<IActionResult> UploadFile(IFormFile file)
        {
            try
            {
                // Get roomId from FormData
                var roomId = Request.Form["roomId"].FirstOrDefault();
                
                _logger.LogInformation($"File upload attempt - File: {file?.FileName}, Size: {file?.Length}, RoomId: {roomId}");
                
                if (file == null || file.Length == 0)
                {
                    _logger.LogWarning("File upload failed: No file provided");
                    return BadRequest("Dosya seçilmedi.");
                }

                // Dosya boyutu kontrolü (10MB)
                if (file.Length > 10 * 1024 * 1024)
                {
                    return BadRequest("Dosya boyutu 10MB'dan büyük olamaz.");
                }

                // Dosya uzantısı kontrolü - sadece PDF
                var fileExtension = Path.GetExtension(file.FileName).ToLowerInvariant();
                
                if (fileExtension != ".pdf")
                {
                    return BadRequest("Sadece PDF dosyaları yüklenebilir. Lütfen PDF formatında bir dosya seçin.");
                }

                // MIME type kontrolü - sadece PDF
                if (file.ContentType != "application/pdf")
                {
                    return BadRequest("Sadece PDF dosyaları yüklenebilir. Lütfen PDF formatında bir dosya seçin.");
                }

                // Kullanıcı bilgilerini al
                var userId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
                var userName = User.FindFirstValue("name") ?? "Unknown";

                if (string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(roomId))
                {
                    _logger.LogWarning($"File upload failed: Invalid user or room - UserId: {userId}, RoomId: {roomId}");
                    return BadRequest("Geçersiz kullanıcı veya oda bilgisi.");
                }

                // Dosya adını güvenli hale getir
                var safeFileName = $"{Guid.NewGuid()}_{Path.GetFileName(file.FileName)}";
                
                // AWS için daha güvenli dosya yolu
                // AWS Lambda/EC2 için alternatif yol kontrolü
                var basePath = _environment.ContentRootPath;
                if (Directory.Exists("/tmp") && !Directory.Exists(Path.Combine(basePath, "uploads")))
                {
                    basePath = "/tmp";
                    _logger.LogInformation("Using /tmp directory for AWS deployment");
                }
                var uploadsPath = Path.Combine(basePath, "uploads", "chat-files", roomId);
                
                // AWS'de klasör oluşturma için try-catch
                try
                {
                    if (!Directory.Exists(uploadsPath))
                    {
                        Directory.CreateDirectory(uploadsPath);
                        _logger.LogInformation($"Created upload directory: {uploadsPath}");
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, $"Failed to create upload directory: {uploadsPath}");
                    return StatusCode(500, "Dosya klasörü oluşturulamadı.");
                }

                var filePath = Path.Combine(uploadsPath, safeFileName);

                // Dosyayı kaydet - AWS için güçlendirilmiş
                try
                {
                    using (var stream = new FileStream(filePath, FileMode.Create))
                    {
                        await file.CopyToAsync(stream);
                    }
                    _logger.LogInformation($"File saved successfully: {filePath}");
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, $"Failed to save file: {filePath}");
                    return StatusCode(500, "Dosya kaydedilemedi.");
                }

                // Dosya bilgilerini döndür
                var fileInfo = new
                {
                    id = Guid.NewGuid().ToString(),
                    originalFileName = file.FileName,
                    fileName = safeFileName,
                    fileSize = file.Length,
                    fileType = fileExtension,
                    uploadPath = $"uploads/chat-files/{roomId}/{safeFileName}",
                    userId = userId,
                    userName = userName,
                    timestamp = DateTimeOffset.UtcNow
                };

                return Ok(fileInfo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Dosya yükleme hatası");
                return StatusCode(500, "Dosya yüklenirken bir hata oluştu.");
            }
        }

        [HttpGet("download/{roomId}/{fileName}")]
        public async Task<IActionResult> DownloadFile(string roomId, string fileName)
        {
            try
            {
                // URL decode the fileName to handle special characters and spaces
                var decodedFileName = Uri.UnescapeDataString(fileName);
                _logger.LogInformation($"Download request - RoomId: {roomId}, FileName: {decodedFileName}");
                
                // SECURITY: Validate roomId format (must be meeting-{guid})
                if (!roomId.StartsWith("meeting-") || !Guid.TryParse(roomId[8..], out var meetingId))
                {
                    _logger.LogWarning($"Invalid roomId format: {roomId}");
                    return BadRequest("Geçersiz oda ID formatı.");
                }
                
                // SECURITY: Check if user has access to this meeting
                var userId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
                if (string.IsNullOrEmpty(userId))
                {
                    _logger.LogWarning("User ID not found in token");
                    return Unauthorized("Kullanıcı bilgisi bulunamadı.");
                }
                
                // SECURITY: Verify user has access to this meeting
                var meeting = await _db.Meetings.FindAsync(meetingId);
                if (meeting == null)
                {
                    _logger.LogWarning($"Meeting not found: {meetingId}");
                    return NotFound("Toplantı bulunamadı.");
                }
                
                // SECURITY: Check if user is meeting creator or participant
                if (meeting.CreatorId.ToString() != userId)
                {
                    // For now, allow all authenticated users to download files from meetings
                    // In a more secure system, you would check a participants table
                    _logger.LogInformation($"User {userId} accessing meeting {meetingId} files (not creator)");
                }
                
                // SECURITY: Prevent path traversal attacks
                if (decodedFileName.Contains("..") || decodedFileName.Contains("/") || decodedFileName.Contains("\\"))
                {
                    _logger.LogWarning($"Path traversal attempt detected: {decodedFileName}");
                    return BadRequest("Geçersiz dosya adı.");
                }
                
                // AWS için aynı yol mantığını kullan
                var basePath = _environment.ContentRootPath;
                if (Directory.Exists("/tmp") && !Directory.Exists(Path.Combine(basePath, "uploads")))
                {
                    basePath = "/tmp";
                }
                var filePath = Path.Combine(basePath, "uploads", "chat-files", roomId, decodedFileName);
                
                if (!System.IO.File.Exists(filePath))
                {
                    _logger.LogWarning($"File not found at path: {filePath}");
                    return NotFound("Dosya bulunamadı.");
                }

                var fileBytes = System.IO.File.ReadAllBytes(filePath);
                
                // Extract original filename by removing the GUID prefix
                // Format: GUID_OriginalFileName.extension
                var originalFileName = decodedFileName;
                if (decodedFileName.Contains('_'))
                {
                    var underscoreIndex = decodedFileName.IndexOf('_');
                    // Check if the part before underscore looks like a GUID (contains dashes and is 36 chars)
                    var potentialGuid = decodedFileName.Substring(0, underscoreIndex);
                    if (potentialGuid.Length == 36 && potentialGuid.Count(c => c == '-') == 4)
                    {
                        // This looks like a GUID, extract the original filename
                        originalFileName = decodedFileName.Substring(underscoreIndex + 1);
                    }
                }
                
                // Determine content type based on file extension
                var contentType = GetContentType(Path.GetExtension(originalFileName).ToLowerInvariant());
                
                _logger.LogInformation($"File downloaded successfully - OriginalName: {originalFileName}, Size: {fileBytes.Length}");
                return File(fileBytes, contentType, originalFileName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Dosya indirme hatası");
                return StatusCode(500, "Dosya indirilirken bir hata oluştu.");
            }
        }

        [HttpDelete("cleanup/{roomId}")]
        public async Task<IActionResult> CleanupMeetingFiles(string roomId)
        {
            try
            {
                _logger.LogInformation($"File cleanup request - RoomId: {roomId}");
                
                // SECURITY: Validate roomId format (must be meeting-{guid})
                if (!roomId.StartsWith("meeting-") || !Guid.TryParse(roomId[8..], out var meetingId))
                {
                    _logger.LogWarning($"Invalid roomId format: {roomId}");
                    return BadRequest("Geçersiz oda ID formatı.");
                }
                
                // SECURITY: Check if user has access to this meeting
                var userId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
                if (string.IsNullOrEmpty(userId))
                {
                    _logger.LogWarning("User ID not found in token");
                    return Unauthorized("Kullanıcı bilgisi bulunamadı.");
                }
                
                // SECURITY: Verify user has access to this meeting
                var meeting = await _db.Meetings.FindAsync(meetingId);
                if (meeting == null)
                {
                    _logger.LogWarning($"Meeting not found: {meetingId}");
                    return NotFound("Toplantı bulunamadı.");
                }
                
                // SECURITY: Check if user is meeting creator or participant
                if (meeting.CreatorId.ToString() != userId)
                {
                    _logger.LogWarning($"User {userId} does not have access to meeting {meetingId}");
                    return BadRequest("Bu toplantıya erişim yetkiniz yok.");
                }
                
                var uploadsPath = Path.Combine(_environment.ContentRootPath, "uploads", "chat-files");
                var meetingFolderPath = Path.Combine(uploadsPath, roomId);
                
                if (!Directory.Exists(meetingFolderPath))
                {
                    _logger.LogInformation($"No files found for room {roomId}");
                    return Ok(new { message = "Silinecek dosya bulunamadı.", deletedFiles = 0 });
                }

                // Count files before deletion
                var files = Directory.GetFiles(meetingFolderPath, "*", SearchOption.AllDirectories);
                var fileCount = files.Length;
                
                // Delete the entire folder
                Directory.Delete(meetingFolderPath, true);
                
                _logger.LogInformation($"Cleaned up {fileCount} files for room {roomId}");
                
                return Ok(new { 
                    message = $"Toplantı dosyaları başarıyla silindi.", 
                    deletedFiles = fileCount,
                    roomId = roomId
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Dosya temizleme hatası");
                return StatusCode(500, "Dosya temizlenirken bir hata oluştu.");
            }
        }

        private string GetContentType(string extension)
        {
            return extension switch
            {
                ".pdf" => "application/pdf",
                ".doc" => "application/msword",
                ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".txt" => "text/plain",
                ".jpg" => "image/jpeg",
                ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".gif" => "image/gif",
                ".zip" => "application/zip",
                ".rar" => "application/x-rar-compressed",
                ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ".xls" => "application/vnd.ms-excel",
                ".pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                ".ppt" => "application/vnd.ms-powerpoint",
                _ => "application/octet-stream"
            };
        }
    }
}
