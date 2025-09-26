using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RandevuCore.Application.DTOs;
using RandevuCore.Infrastructure.Services;
using System.Security.Claims;

namespace RandevuCore.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class MeetingsController : ControllerBase
    {
        private readonly MeetingService _service;
        public MeetingsController(MeetingService service) => _service = service;

        private Guid GetUserId() => Guid.Parse(User.FindFirstValue("sub")!);

        [HttpGet]
        public async Task<IActionResult> List()
        {
            var userId = GetUserId();
            var list = await _service.GetUserMeetingsAsync(userId);
            return Ok(list);
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] MeetingCreateDto dto)
        {
            var userId = GetUserId();
            var (ok, error, id) = await _service.CreateAsync(userId, dto);
            if (!ok) return BadRequest(new { error });
            return CreatedAtAction(nameof(GetById), new { id }, new { id });
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetById([FromRoute] Guid id)
        {
            var userId = GetUserId();
            var list = await _service.GetUserMeetingsAsync(userId);
            var item = list.FirstOrDefault(x => x.Id == id);
            if (item == null) return NotFound();
            return Ok(item);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Update([FromRoute] Guid id, [FromBody] MeetingUpdateDto dto)
        {
            var userId = GetUserId();
            var (ok, error) = await _service.UpdateAsync(id, userId, dto);
            if (!ok) return BadRequest(new { error });
            return NoContent();
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete([FromRoute] Guid id)
        {
            var userId = GetUserId();
            var (ok, error) = await _service.DeleteAsync(id, userId);
            if (!ok) return BadRequest(new { error });
            return NoContent();
        }
    }
}


