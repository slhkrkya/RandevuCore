using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RandevuCore.Application.Services;

namespace RandevuCore.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class UsersController : ControllerBase
    {
        private readonly UserService _service;
        public UsersController(UserService service) => _service = service;

        [HttpGet]
        public async Task<IActionResult> List()
        {
            var users = await _service.GetAllAsync();
            return Ok(users);
        }
    }
}


