# SplitNest

SplitNest is a full-stack shared expenses web application built to intelligently parse, analyze, and settle shared expenses from CSV exports.

## Project Structure

This repository is organized as a monorepo:
- `/backend`: Node.js, Express, and Prisma PostgreSQL REST API. Handles anomaly detection, split math, and data persistence.
- `/frontend`: React frontend built with Vite. Handles the user interface, group management, and import reviews.

## Live Deployments
- **Backend API**: [https://splitnest-am8r.onrender.com](https://splitnest-am8r.onrender.com)

## Local Development

### Prerequisites
- Node.js (v20+)
- PostgreSQL database (or Neon/Supabase free tier)

### 1. Backend Setup
1. Navigate to the backend directory: `cd backend`
2. Install dependencies: `npm install`
3. Copy the environment variables: `cp .env.example .env` (Add your `DATABASE_URL` and `JWT_SECRET`)
4. Sync the database schema: `npx prisma db push`
5. Start the development server: `npm run dev` (Runs on port 3001)

### 2. Frontend Setup
1. Navigate to the frontend directory: `cd frontend`
2. Install dependencies: `npm install`
3. Add environment variables if needed (e.g. `VITE_API_URL=http://localhost:3001`)
4. Start the development server: `npm run dev` (Runs on port 5173 or 5174)

## Architecture & Documentation

Key architectural decisions and anomaly detection specifications are thoroughly documented in the repository:
- `DECISIONS.md`: Log of all major technical decisions, from stack selection to rounding policies.
- `SCOPE.md`: The specification for the CSV import anomaly detection system.
- `AI_USAGE.md`: A log of how AI was used during the development of this project.
