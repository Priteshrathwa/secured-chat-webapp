# Secure Chat Application - Setup Script
# Run this script to set up the application

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Secure Chat Application - Setup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Python installation
Write-Host "Checking Python installation..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "✓ Python found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Python not found. Please install Python 3.8 or higher." -ForegroundColor Red
    exit 1
}

# Check MySQL installation
Write-Host "Checking MySQL installation..." -ForegroundColor Yellow
try {
    $mysqlVersion = mysql --version 2>&1
    Write-Host "✓ MySQL found: $mysqlVersion" -ForegroundColor Green
} catch {
    Write-Host "⚠ MySQL not found. Please install MySQL 5.7 or higher." -ForegroundColor Red
    Write-Host "  Download from: https://dev.mysql.com/downloads/installer/" -ForegroundColor Yellow
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y") { exit 1 }
}

# Create virtual environment
Write-Host ""
Write-Host "Creating virtual environment..." -ForegroundColor Yellow
if (Test-Path "venv") {
    Write-Host "✓ Virtual environment already exists" -ForegroundColor Green
} else {
    python -m venv venv
    Write-Host "✓ Virtual environment created" -ForegroundColor Green
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& ".\venv\Scripts\Activate.ps1"
Write-Host "✓ Virtual environment activated" -ForegroundColor Green

# Install dependencies
Write-Host ""
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
pip install --upgrade pip
pip install -r requirements.txt
Write-Host "✓ Dependencies installed" -ForegroundColor Green

# Create .env file if it doesn't exist
Write-Host ""
if (-not (Test-Path ".env")) {
    Write-Host "Creating .env file..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "✓ .env file created" -ForegroundColor Green
    Write-Host ""
    Write-Host "⚠ IMPORTANT: Edit .env file with your database credentials!" -ForegroundColor Red
    Write-Host "  Required settings:" -ForegroundColor Yellow
    Write-Host "  - DB_NAME" -ForegroundColor Yellow
    Write-Host "  - DB_USER" -ForegroundColor Yellow
    Write-Host "  - DB_PASSWORD" -ForegroundColor Yellow
    Write-Host ""
    $editNow = Read-Host "Would you like to edit .env now? (y/n)"
    if ($editNow -eq "y") {
        notepad .env
        Write-Host "Press any key after editing .env..." -ForegroundColor Yellow
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
} else {
    Write-Host "✓ .env file already exists" -ForegroundColor Green
}

# Create MySQL database
Write-Host ""
Write-Host "Database Setup" -ForegroundColor Cyan
Write-Host "=============" -ForegroundColor Cyan
$setupDb = Read-Host "Would you like to create the MySQL database now? (y/n)"
if ($setupDb -eq "y") {
    $dbName = Read-Host "Enter database name (default: secure_chat_db)"
    if ([string]::IsNullOrWhiteSpace($dbName)) {
        $dbName = "secure_chat_db"
    }
    
    $mysqlUser = Read-Host "Enter MySQL username (default: root)"
    if ([string]::IsNullOrWhiteSpace($mysqlUser)) {
        $mysqlUser = "root"
    }
    
    $mysqlPassword = Read-Host "Enter MySQL password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($mysqlPassword)
    $mysqlPasswordPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    
    Write-Host "Creating database..." -ForegroundColor Yellow
    $query = "CREATE DATABASE IF NOT EXISTS $dbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    
    try {
        mysql -u $mysqlUser -p"$mysqlPasswordPlain" -e $query
        Write-Host "✓ Database '$dbName' created successfully" -ForegroundColor Green
    } catch {
        Write-Host "✗ Failed to create database. Please create it manually." -ForegroundColor Red
    }
}

# Run migrations
Write-Host ""
Write-Host "Running database migrations..." -ForegroundColor Yellow
try {
    python manage.py makemigrations
    python manage.py migrate
    Write-Host "✓ Migrations completed" -ForegroundColor Green
} catch {
    Write-Host "✗ Migration failed. Please check your database configuration." -ForegroundColor Red
}

# Create superuser
Write-Host ""
$createSuperuser = Read-Host "Would you like to create a superuser? (y/n)"
if ($createSuperuser -eq "y") {
    Write-Host "Creating superuser..." -ForegroundColor Yellow
    python manage.py createsuperuser
}

# Collect static files
Write-Host ""
Write-Host "Collecting static files..." -ForegroundColor Yellow
try {
    python manage.py collectstatic --noinput
    Write-Host "✓ Static files collected" -ForegroundColor Green
} catch {
    Write-Host "⚠ Failed to collect static files" -ForegroundColor Yellow
}

# Final instructions
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Ensure .env file is configured correctly" -ForegroundColor White
Write-Host "2. Start the server with one of these commands:" -ForegroundColor White
Write-Host ""
Write-Host "   Option A (Recommended - Full WebSocket support):" -ForegroundColor Cyan
Write-Host "   daphne -b 127.0.0.1 -p 8000 secure_chat.asgi:application" -ForegroundColor White
Write-Host ""
Write-Host "   Option B (Django dev server - Limited WebSocket):" -ForegroundColor Cyan
Write-Host "   python manage.py runserver" -ForegroundColor White
Write-Host ""
Write-Host "3. Open browser and navigate to:" -ForegroundColor White
Write-Host "   http://localhost:8000" -ForegroundColor Green
Write-Host ""
Write-Host "4. Register a new account and start chatting!" -ForegroundColor White
Write-Host ""
Write-Host "Documentation:" -ForegroundColor Yellow
Write-Host "- README.md - Complete documentation" -ForegroundColor White
Write-Host "- QUICKSTART.md - 5-minute quick start" -ForegroundColor White
Write-Host "- DEPLOYMENT.md - Production deployment" -ForegroundColor White
Write-Host ""
Write-Host "For help, see: QUICKSTART.md" -ForegroundColor Yellow
Write-Host ""

# Ask to start server
$startServer = Read-Host "Would you like to start the server now? (y/n)"
if ($startServer -eq "y") {
    Write-Host ""
    Write-Host "Starting server..." -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
    Write-Host ""
    daphne -b 127.0.0.1 -p 8000 secure_chat.asgi:application
}
