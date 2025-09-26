using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RandevuCore.Application.DTOs;
using RandevuCore.Application.Services;
using System.Security.Claims;

namespace RandevuCore.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class AppointmentsController : ControllerBase
    {
        private readonly AppointmentService _service;
        public AppointmentsController(AppointmentService service) => _service = service;

        private Guid GetUserId() => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);

        [HttpGet]
        public async Task<IActionResult> List()
        {
            var userId = GetUserId();
            var list = await _service.GetUserAppointmentsAsync(userId);
            return Ok(list);
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] AppointmentCreateDto dto)
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
            var list = await _service.GetUserAppointmentsAsync(userId);
            var item = list.FirstOrDefault(x => x.Id == id);
            if (item == null) return NotFound();
            return Ok(item);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Update([FromRoute] Guid id, [FromBody] AppointmentUpdateDto dto)
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


