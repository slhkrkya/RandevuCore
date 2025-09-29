using Microsoft.AspNetCore.Identity;
using RandevuCore.Application.DTOs;
using RandevuCore.Domain.Entities;
using RandevuCore.Domain.Interfaces;

namespace RandevuCore.Application.Services
{
    public class UserService
    {
        private readonly IUserRepository _userRepository;
        private readonly IPasswordHasher<User> _passwordHasher;
        private readonly IJwtTokenService _jwtService;

        public UserService(IUserRepository userRepository, IPasswordHasher<User> passwordHasher, IJwtTokenService jwtService)
        {
            _userRepository = userRepository;
            _passwordHasher = passwordHasher;
            _jwtService = jwtService;
        }

        public async Task<AuthResponseDto?> RegisterAsync(RegisterDto dto)
        {
            if (await _userRepository.GetByEmailAsync(dto.Email.ToLower()) != null)
                return null; // email zaten var

            var user = new User
            {
                Id = Guid.NewGuid(),
                Email = dto.Email.ToLower(),
                Name = dto.Name,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };

            user.PasswordHash = _passwordHasher.HashPassword(user, dto.Password);
            await _userRepository.AddAsync(user);

            var token = _jwtService.GenerateToken(user);
            return new AuthResponseDto { Token = token, Email = user.Email, Name = user.Name };
        }

        public async Task<AuthResponseDto?> LoginAsync(LoginDto dto)
        {
            var user = await _userRepository.GetByEmailAsync(dto.Email.ToLower());
            if (user == null) return null;

            var result = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, dto.Password);
            if (result == PasswordVerificationResult.Failed) return null;

            var token = _jwtService.GenerateToken(user);
            return new AuthResponseDto { Token = token, Email = user.Email, Name = user.Name };
        }

        public async Task<List<UserListItemDto>> GetAllAsync()
        {
            var users = await _userRepository.GetAllAsync();
            return users.Select(u => new UserListItemDto { Id = u.Id, Email = u.Email, Name = u.Name }).ToList();
        }

        // Profil metodları
        public async Task<ProfileDto?> GetProfileAsync(Guid userId)
        {
            var user = await _userRepository.GetByIdAsync(userId);
            if (user == null) return null;

            return new ProfileDto
            {
                Id = user.Id,
                Name = user.Name,
                Email = user.Email,
                CreatedAt = user.CreatedAt,
                UpdatedAt = user.UpdatedAt
            };
        }

        public async Task<(bool success, string? error)> UpdateProfileAsync(Guid userId, UpdateProfileDto dto)
        {
            var user = await _userRepository.GetByIdAsync(userId);
            if (user == null) return (false, "Kullanıcı bulunamadı");

            if (string.IsNullOrWhiteSpace(dto.Name))
                return (false, "İsim boş olamaz");

            if (dto.Name.Length > 100)
                return (false, "İsim en fazla 100 karakter olabilir");

            user.Name = dto.Name.Trim();
            user.UpdatedAt = DateTimeOffset.UtcNow;

            await _userRepository.UpdateAsync(user);
            return (true, null);
        }

        public async Task<(bool success, string? error)> ChangePasswordAsync(Guid userId, ChangePasswordDto dto)
        {
            var user = await _userRepository.GetByIdAsync(userId);
            if (user == null) return (false, "Kullanıcı bulunamadı");

            if (string.IsNullOrWhiteSpace(dto.CurrentPassword))
                return (false, "Mevcut şifre boş olamaz");

            if (string.IsNullOrWhiteSpace(dto.NewPassword))
                return (false, "Yeni şifre boş olamaz");

            if (dto.NewPassword.Length < 6)
                return (false, "Yeni şifre en az 6 karakter olmalı");

            if (dto.NewPassword != dto.ConfirmPassword)
                return (false, "Yeni şifreler uyuşmuyor");

            // Mevcut şifreyi kontrol et
            var currentPasswordResult = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, dto.CurrentPassword);
            if (currentPasswordResult == PasswordVerificationResult.Failed)
                return (false, "Mevcut şifre yanlış");

            // Yeni şifreyi hashle ve kaydet
            user.PasswordHash = _passwordHasher.HashPassword(user, dto.NewPassword);
            user.UpdatedAt = DateTimeOffset.UtcNow;

            await _userRepository.UpdateAsync(user);
            return (true, null);
        }
    }
}