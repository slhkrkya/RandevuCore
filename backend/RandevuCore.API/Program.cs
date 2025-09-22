using Microsoft.EntityFrameworkCore;
using RandevuCore.Infrastructure.Persistence;
using RandevuCore.Application.Interfaces;
using RandevuCore.Application.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddScoped<IAppointmentService, AppointmentService>();
builder.Services.AddDbContext<RandevuCoreDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddControllers();

var app = builder.Build();
app.MapControllers();
app.Run();