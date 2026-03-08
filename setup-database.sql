-- DropZone MariaDB Setup Script
-- Run this as root: sudo mariadb < setup-database.sql

-- Create database
CREATE DATABASE IF NOT EXISTS dropzone CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Drop user if exists
DROP USER IF EXISTS 'dropzone'@'localhost';

-- Option 1: Use unix_socket authentication (recommended for local connections - no password needed, more secure)
-- Uncomment this if you want socket auth (requires running app as 'dropzone' user or mapping in MariaDB):
-- CREATE USER 'dropzone'@'localhost' IDENTIFIED VIA unix_socket;

-- Option 2: Use password authentication with mysql_native_password (works but may have plugin issues)
-- Using a combination that forces mysql_native_password and avoids gssapi
CREATE USER 'dropzone'@'localhost' IDENTIFIED BY 'dropzone_secure_password';
ALTER USER 'dropzone'@'localhost' IDENTIFIED WITH mysql_native_password BY 'dropzone_secure_password';

-- Grant privileges
GRANT ALL PRIVILEGES ON dropzone.* TO 'dropzone'@'localhost';
FLUSH PRIVILEGES;

-- Show the user configuration
SELECT user, host, plugin FROM mysql.user WHERE user='dropzone';

-- Use the database
USE dropzone;

-- Tables will be created automatically by the application on first run
SELECT '✓ Database setup complete! Check that plugin is mysql_native_password above.' AS message;
