using Microsoft.EntityFrameworkCore;
using RandevuCore.Domain.Interfaces;
using RandevuCore.Infrastructure.Persistence;
using RandevuCore.Infrastructure.Repositories;

var builder = WebApplication.CreateBuilder(args);

// DbContext
builder.Services.AddDbContext<RandevuDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection"))
);

// Dependency Injection
builder.Services.AddScoped<IAppointmentRepository, AppointmentRepository>();

// Add controllers, swagger, etc.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Middleware
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();