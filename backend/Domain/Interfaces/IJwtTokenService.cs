using RandevuCore.Domain.Entities;

namespace RandevuCore.Domain.Interfaces
{
    public interface IJwtTokenService
    {
        string GenerateToken(User user);
    }
}