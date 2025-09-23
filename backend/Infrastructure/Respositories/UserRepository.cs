using Microsoft.EntityFrameworkCore;
using RandevuCore.Domain.Entities;
using RandevuCore.Domain.Interfaces;
using RandevuCore.Infrastructure.Persistence;

namespace RandevuCore.Infrastructure.Repositories
{
    public class UserRepository : IUserRepository
    {
        private readonly RandevuDbContext _context;
        public UserRepository(RandevuDbContext context) => _context = context;

        public async Task<User?> GetByEmailAsync(string email)
            => await _context.Users.FirstOrDefaultAsync(u => u.Email == email);

        public async Task AddAsync(User user)
        {
            _context.Users.Add(user);
            await _context.SaveChangesAsync();
        }
    }
}