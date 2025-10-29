#!/bin/bash

# Secure Chat Application - Setup Script
# Run this script to set up the application

echo "========================================"
echo "Secure Chat Application - Setup Script"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check Python installation
echo -e "${YELLOW}Checking Python installation...${NC}"
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo -e "${GREEN}✓ Python found: $PYTHON_VERSION${NC}"
    PYTHON_CMD=python3
elif command -v python &> /dev/null; then
    PYTHON_VERSION=$(python --version)
    echo -e "${GREEN}✓ Python found: $PYTHON_VERSION${NC}"
    PYTHON_CMD=python
else
    echo -e "${RED}✗ Python not found. Please install Python 3.8 or higher.${NC}"
    exit 1
fi

# Check pip installation
if command -v pip3 &> /dev/null; then
    PIP_CMD=pip3
elif command -v pip &> /dev/null; then
    PIP_CMD=pip
else
    echo -e "${RED}✗ pip not found. Please install pip.${NC}"
    exit 1
fi

# Check MySQL installation
echo -e "${YELLOW}Checking MySQL installation...${NC}"
if command -v mysql &> /dev/null; then
    MYSQL_VERSION=$(mysql --version)
    echo -e "${GREEN}✓ MySQL found: $MYSQL_VERSION${NC}"
else
    echo -e "${RED}⚠ MySQL not found. Please install MySQL 5.7 or higher.${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Create virtual environment
echo ""
echo -e "${YELLOW}Creating virtual environment...${NC}"
if [ -d "venv" ]; then
    echo -e "${GREEN}✓ Virtual environment already exists${NC}"
else
    $PYTHON_CMD -m venv venv
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi

# Activate virtual environment
echo -e "${YELLOW}Activating virtual environment...${NC}"
source venv/bin/activate
echo -e "${GREEN}✓ Virtual environment activated${NC}"

# Install dependencies
echo ""
echo -e "${YELLOW}Installing Python dependencies...${NC}"
$PIP_CMD install --upgrade pip
$PIP_CMD install -r requirements.txt
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Create .env file if it doesn't exist
echo ""
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Creating .env file...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓ .env file created${NC}"
    echo ""
    echo -e "${RED}⚠ IMPORTANT: Edit .env file with your database credentials!${NC}"
    echo -e "${YELLOW}  Required settings:${NC}"
    echo -e "${YELLOW}  - DB_NAME${NC}"
    echo -e "${YELLOW}  - DB_USER${NC}"
    echo -e "${YELLOW}  - DB_PASSWORD${NC}"
    echo ""
    read -p "Would you like to edit .env now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} .env
    fi
else
    echo -e "${GREEN}✓ .env file already exists${NC}"
fi

# Create MySQL database
echo ""
echo -e "${CYAN}Database Setup${NC}"
echo "============="
read -p "Would you like to create the MySQL database now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Enter database name (default: secure_chat_db): " DB_NAME
    DB_NAME=${DB_NAME:-secure_chat_db}
    
    read -p "Enter MySQL username (default: root): " MYSQL_USER
    MYSQL_USER=${MYSQL_USER:-root}
    
    read -sp "Enter MySQL password: " MYSQL_PASSWORD
    echo
    
    echo -e "${YELLOW}Creating database...${NC}"
    QUERY="CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    
    if mysql -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "$QUERY" 2>/dev/null; then
        echo -e "${GREEN}✓ Database '$DB_NAME' created successfully${NC}"
    else
        echo -e "${RED}✗ Failed to create database. Please create it manually.${NC}"
    fi
fi

# Create logs directory
echo ""
echo -e "${YELLOW}Creating logs directory...${NC}"
mkdir -p logs
echo -e "${GREEN}✓ Logs directory created${NC}"

# Run migrations
echo ""
echo -e "${YELLOW}Running database migrations...${NC}"
if $PYTHON_CMD manage.py makemigrations && $PYTHON_CMD manage.py migrate; then
    echo -e "${GREEN}✓ Migrations completed${NC}"
else
    echo -e "${RED}✗ Migration failed. Please check your database configuration.${NC}"
fi

# Create superuser
echo ""
read -p "Would you like to create a superuser? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Creating superuser...${NC}"
    $PYTHON_CMD manage.py createsuperuser
fi

# Collect static files
echo ""
echo -e "${YELLOW}Collecting static files...${NC}"
if $PYTHON_CMD manage.py collectstatic --noinput; then
    echo -e "${GREEN}✓ Static files collected${NC}"
else
    echo -e "${YELLOW}⚠ Failed to collect static files${NC}"
fi

# Final instructions
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Ensure .env file is configured correctly"
echo "2. Start the server with one of these commands:"
echo ""
echo -e "${CYAN}   Option A (Recommended - Full WebSocket support):${NC}"
echo "   daphne -b 127.0.0.1 -p 8000 secure_chat.asgi:application"
echo ""
echo -e "${CYAN}   Option B (Django dev server - Limited WebSocket):${NC}"
echo "   python manage.py runserver"
echo ""
echo "3. Open browser and navigate to:"
echo -e "   ${GREEN}http://localhost:8000${NC}"
echo ""
echo "4. Register a new account and start chatting!"
echo ""
echo -e "${YELLOW}Documentation:${NC}"
echo "- README.md - Complete documentation"
echo "- QUICKSTART.md - 5-minute quick start"
echo "- DEPLOYMENT.md - Production deployment"
echo ""
echo -e "${YELLOW}For help, see: QUICKSTART.md${NC}"
echo ""

# Ask to start server
read -p "Would you like to start the server now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${GREEN}Starting server...${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
    echo ""
    daphne -b 127.0.0.1 -p 8000 secure_chat.asgi:application
fi
