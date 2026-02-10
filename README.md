# Vibe Check Spots

Find spots your group will love. Vote on real local places, discover shared favorites.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/vibe-check-spots?referralCode=travis)

## Quick Deploy

Click the button above, then add these environment variables:
- `SYNTHETIC_API_KEY` - Your Synthetic.new API key (optional, for fallback suggestions)
- `NODE_ENV` - Set to `production`

## Local Development

```bash
# Install dependencies
cd client && npm install && cd ../server && npm install && cd ..

# Create .env file
cp .env.example .env
# Add your API keys to .env

# Run dev server
npm run dev
```

## How It Works

1. Create a session, pick a category (food/drinks/activities), enter your location
2. Share the link - everyone votes on real places from OpenStreetMap
3. Algorithm finds shared favorites and places to try based on overlap
