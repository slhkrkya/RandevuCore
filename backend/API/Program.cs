using Microsoft.EntityFrameworkCore;
using RandevuCore.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity; // PasswordHasher için
using RandevuCore.Domain.Entities;   // User entity
using RandevuCore.Domain.Interfaces; // IRepository interface’leri
using RandevuCore.Application.Services; // UserService
using RandevuCore.Infrastructure.Repositories; // AppointmentRepository, UserRepository
using RandevuCore.Infrastructure.Services; // JwtTokenService

var builder = WebApplication.CreateBuilder(args);

// DbContext
builder.Services.AddDbContext<RandevuDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection"))
);

// Dependency Injection
builder.Services.AddScoped<IAppointmentRepository, AppointmentRepository>();
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();

// Add controllers, swagger, etc.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// CORS
const string FrontendCorsPolicy = "FrontendCorsPolicy";
builder.Services.AddCors(options =>
{
	options.AddPolicy(FrontendCorsPolicy, policy =>
	{
		policy.WithOrigins("http://localhost:4200")
			.AllowAnyMethod()
			.AllowAnyHeader()
			.AllowCredentials();
	});
});

var app = builder.Build();

// Middleware
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseCors(FrontendCorsPolicy);
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();