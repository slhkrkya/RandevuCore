using Microsoft.EntityFrameworkCore;
using RandevuCore.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity; // PasswordHasher için
using RandevuCore.Domain.Entities;   // User entity
using RandevuCore.Domain.Interfaces; // IRepository interface’leri
using RandevuCore.Application.Services; // UserService
using RandevuCore.Infrastructure.Repositories; // AppointmentRepository, UserRepository
using RandevuCore.Infrastructure.Services; // JwtTokenService, MeetingService
using RandevuCore.API.Services; // MeetingCleanupService
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

// DbContext
builder.Services.AddDbContext<RandevuDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("DefaultConnection"),
        sql => sql.EnableRetryOnFailure(5, TimeSpan.FromSeconds(10), null)
    )
);

// Dependency Injection
builder.Services.AddScoped<IAppointmentRepository, AppointmentRepository>();
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<AppointmentService>();
builder.Services.AddScoped<MeetingService>();
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();

// Background Services
builder.Services.AddHostedService<MeetingCleanupService>();

// JWT Authentication
var jwtSection = builder.Configuration.GetSection("JwtSettings");
var jwtSecret = jwtSection.GetValue<string>("Secret");
var jwtIssuer = jwtSection.GetValue<string>("Issuer");
var jwtAudience = jwtSection.GetValue<string>("Audience");

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateIssuerSigningKey = true,
        ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero,
        ValidIssuer = jwtIssuer,
        ValidAudience = jwtAudience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret ?? throw new InvalidOperationException("Authentication configuration error")))
    };
    // Allow JWT via access_token query for SignalR websockets
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            var accessToken = context.Request.Query["access_token"].ToString();
            var path = context.HttpContext.Request.Path;
            if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/ws"))
            {
                context.Token = accessToken;
            }
            return Task.CompletedTask;
        }
    };
});

// Add controllers, swagger, etc.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure form options for file uploads
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 10 * 1024 * 1024; // 10MB
    options.ValueLengthLimit = 10 * 1024 * 1024; // 10MB
    options.MultipartHeadersLengthLimit = 10 * 1024 * 1024; // 10MB
});

// Configure static file serving for uploads (for production)
if (builder.Environment.IsProduction())
{
    builder.Services.Configure<IISServerOptions>(options =>
    {
        options.MaxRequestBodySize = 10 * 1024 * 1024; // 10MB
    });
}
builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = true;
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(30);
    options.HandshakeTimeout = TimeSpan.FromSeconds(15);
    options.MaximumReceiveMessageSize = 10 * 1024 * 1024; // 10MB for file uploads
});

// CORS (configurable via configuration/env: Cors:Origins as comma-separated list)
const string FrontendCorsPolicy = "FrontendCorsPolicy";
var corsOrigins = builder.Configuration.GetSection("Cors").GetValue<string>("Origins");
var allowedOrigins = (corsOrigins ?? "http://localhost:4200,https://staj.salihkarakaya.com.tr,http://staj.salihkarakaya.com.tr")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
    {
        policy.WithOrigins(allowedOrigins)
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
    // Auto-apply EF Core migrations in development for easier local setup
    using (var scope = app.Services.CreateScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<RandevuDbContext>();
        db.Database.Migrate();
    }
}

// Force HTTPS in production
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
    // Respect reverse proxy headers (X-Forwarded-Proto/For/Host)
    app.UseForwardedHeaders(new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost
    });
    app.Use(async (context, next) =>
    {
        if (!context.Request.IsHttps && context.Request.Headers["X-Forwarded-Proto"] != "https")
        {
            var httpsUrl = $"https://{context.Request.Host}{context.Request.PathBase}{context.Request.Path}{context.Request.QueryString}";
            context.Response.Redirect(httpsUrl, permanent: true);
            return;
        }
        await next();
    });
}
// Detect uploads folder dynamically (for AWS/Linux compatibility)
var uploadPath = Path.Combine(app.Environment.ContentRootPath, "uploads");

// Eğer uploads dizini yoksa oluştur
if (!Directory.Exists(uploadPath))
{
    Directory.CreateDirectory(uploadPath);
}

// AWS ortamında bazen uygulama /tmp dizinine yazma iznine sahiptir
if (!Directory.Exists(uploadPath) || !HasWritePermission(uploadPath))
{
    uploadPath = "/tmp/uploads";
    if (!Directory.Exists(uploadPath))
    {
        Directory.CreateDirectory(uploadPath);
    }
}

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadPath),
    RequestPath = "/uploads"
});

// Helper: write permission kontrolü
bool HasWritePermission(string path)
{
    try
    {
        string testFile = Path.Combine(path, Path.GetRandomFileName());
        File.WriteAllText(testFile, "test");
        File.Delete(testFile);
        return true;
    }
    catch
    {
        return false;
    }
}

// In development, do not force HTTPS redirection to simplify local testing
app.UseCors(FrontendCorsPolicy);
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<RandevuCore.API.Realtime.RealtimeHub>("/ws");

app.Run();