IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
CREATE TABLE [Users] (
    [Id] uniqueidentifier NOT NULL,
    [Email] nvarchar(max) NOT NULL,
    [PasswordHash] nvarchar(max) NOT NULL,
    [Name] nvarchar(max) NOT NULL,
    [CreatedAt] datetimeoffset NOT NULL,
    [UpdatedAt] datetimeoffset NOT NULL,
    CONSTRAINT [PK_Users] PRIMARY KEY ([Id])
);

CREATE TABLE [Appointments] (
    [Id] uniqueidentifier NOT NULL,
    [Title] nvarchar(max) NOT NULL,
    [StartsAt] datetimeoffset NOT NULL,
    [EndsAt] datetimeoffset NOT NULL,
    [Status] int NOT NULL,
    [Notes] nvarchar(max) NULL,
    [CreatorId] uniqueidentifier NOT NULL,
    [InviteeId] uniqueidentifier NOT NULL,
    [CreatedAt] datetimeoffset NOT NULL,
    [UpdatedAt] datetimeoffset NOT NULL,
    CONSTRAINT [PK_Appointments] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_Appointments_Users_CreatorId] FOREIGN KEY ([CreatorId]) REFERENCES [Users] ([Id]) ON DELETE NO ACTION,
    CONSTRAINT [FK_Appointments_Users_InviteeId] FOREIGN KEY ([InviteeId]) REFERENCES [Users] ([Id]) ON DELETE NO ACTION
);

CREATE TABLE [Meetings] (
    [Id] uniqueidentifier NOT NULL,
    [Title] nvarchar(max) NOT NULL,
    [StartsAt] datetimeoffset NOT NULL,
    [EndsAt] datetimeoffset NOT NULL,
    [Notes] nvarchar(max) NULL,
    [VideoSessionId] nvarchar(max) NULL,
    [WhiteboardSessionId] nvarchar(max) NULL,
    [Status] int NOT NULL,
    [CreatorId] uniqueidentifier NOT NULL,
    [CreatedAt] datetimeoffset NOT NULL,
    [UpdatedAt] datetimeoffset NOT NULL,
    CONSTRAINT [PK_Meetings] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_Meetings_Users_CreatorId] FOREIGN KEY ([CreatorId]) REFERENCES [Users] ([Id]) ON DELETE NO ACTION
);

CREATE TABLE [MeetingUser] (
    [InviteesId] uniqueidentifier NOT NULL,
    [MeetingId] uniqueidentifier NOT NULL,
    CONSTRAINT [PK_MeetingUser] PRIMARY KEY ([InviteesId], [MeetingId]),
    CONSTRAINT [FK_MeetingUser_Meetings_MeetingId] FOREIGN KEY ([MeetingId]) REFERENCES [Meetings] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [FK_MeetingUser_Users_InviteesId] FOREIGN KEY ([InviteesId]) REFERENCES [Users] ([Id]) ON DELETE CASCADE
);

CREATE TABLE [WhiteboardPermissions] (
    [Id] uniqueidentifier NOT NULL,
    [MeetingId] uniqueidentifier NOT NULL,
    [UserId] uniqueidentifier NOT NULL,
    [CanDraw] bit NOT NULL,
    CONSTRAINT [PK_WhiteboardPermissions] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_WhiteboardPermissions_Meetings_MeetingId] FOREIGN KEY ([MeetingId]) REFERENCES [Meetings] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [FK_WhiteboardPermissions_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [Users] ([Id]) ON DELETE CASCADE
);

CREATE INDEX [IX_Appointments_CreatorId_StartsAt] ON [Appointments] ([CreatorId], [StartsAt]);

CREATE INDEX [IX_Appointments_InviteeId_StartsAt] ON [Appointments] ([InviteeId], [StartsAt]);

CREATE INDEX [IX_Meetings_CreatorId] ON [Meetings] ([CreatorId]);

CREATE INDEX [IX_MeetingUser_MeetingId] ON [MeetingUser] ([MeetingId]);

CREATE INDEX [IX_WhiteboardPermissions_MeetingId] ON [WhiteboardPermissions] ([MeetingId]);

CREATE INDEX [IX_WhiteboardPermissions_UserId] ON [WhiteboardPermissions] ([UserId]);

INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
VALUES (N'20250923114423_firstMig', N'9.0.9');

ALTER TABLE [Meetings] ADD [ActualStartTime] datetimeoffset NULL;

INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
VALUES (N'20251008103035_InitialCreate', N'9.0.9');

DECLARE @var sysname;
SELECT @var = [d].[name]
FROM [sys].[default_constraints] [d]
INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Users]') AND [c].[name] = N'Email');
IF @var IS NOT NULL EXEC(N'ALTER TABLE [Users] DROP CONSTRAINT [' + @var + '];');
ALTER TABLE [Users] ALTER COLUMN [Email] nvarchar(450) NOT NULL;

CREATE UNIQUE INDEX [IX_Users_Email] ON [Users] ([Email]);

CREATE INDEX [IX_Meetings_CreatorId_StartsAt] ON [Meetings] ([CreatorId], [StartsAt]);

CREATE INDEX [IX_Meetings_StartsAt] ON [Meetings] ([StartsAt]);

INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
VALUES (N'20251017120924_AddPerformanceIndexes', N'9.0.9');

COMMIT;
GO

