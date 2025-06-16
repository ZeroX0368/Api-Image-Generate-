
const express = require('express');
const app = express();
const port = 5000;

app.use(express.json());

// API endpoint for image generation
app.get('/api/image', async (req, res) => {
  try {
    const { prompt } = req.query;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt parameter is required' });
    }

    // Replace with your actual API key
    const API_KEY = '4mXQ1DQ3dFoAWPGNLQBfQV6chN09V0Oh';
    
    const requestBody = [
      {
        taskType: "authentication",
        apiKey: API_KEY
      },
      {
        taskType: "imageInference",
        taskUUID: generateUUID(),
        positivePrompt: prompt,
        width: 512,
        height: 512,
        model: "civitai:102438@133677",
        numberResults: 1
      }
    ];

    console.log('Making request with prompt:', prompt);

    const response = await fetch('https://api.runware.ai/v1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('API Error Details:', data);
      return res.status(response.status).json({ 
        error: 'API request failed', 
        status: response.status,
        details: data 
      });
    }

    res.json(data);

  } catch (error) {
    console.error('Error generating image:', error);
    res.status(500).json({ error: 'Failed to generate image' });
  }
});

// Helper function to generate UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Image generation API is running' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Image generation API running on port ${port}`);
  console.log(`Test with: /api/image?prompt=cat`);
});
