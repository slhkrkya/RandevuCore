using Microsoft.AspNetCore.Mvc;
using RandevuCore.Application.Interfaces;
using RandevuCore.Domain.Entities;

namespace RandevuCore.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AppointmentsController : ControllerBase
    {
        private readonly IAppointmentService _appointmentService;

        public AppointmentsController(IAppointmentService appointmentService)
        {
            _appointmentService = appointmentService;
        }

        [HttpGet]
        public async Task<IActionResult> GetAll(Guid userId)
        {
            var appointments = await _appointmentService.GetAllAppointmentsAsync(userId);
            return Ok(appointments);
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] Appointment appointment)
        {
            try
            {
                var created = await _appointmentService.CreateAppointmentAsync(appointment);
                return Ok(created);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }
    }
}