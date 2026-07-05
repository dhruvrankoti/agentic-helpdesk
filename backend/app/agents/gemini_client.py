import os
import json
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

_client = None

def get_client() -> genai.Client:
    global _client
    if _client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable is not set")
        _client = genai.Client(api_key=api_key)
    return _client

def generate_json(prompt: str, response_schema: type, model: str = "gemini-2.5-flash") -> dict:
    """
    Generates a structured JSON response matching a Pydantic schema using Gemini.
    """
    client = get_client()
    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=response_schema,
                temperature=0.1,
            ),
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"Error calling Gemini generate_json: {e}")
        raise e

def generate_text(prompt: str, model: str = "gemini-2.5-flash") -> str:
    """
    Generates a standard text response using Gemini.
    """
    client = get_client()
    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
            )
        )
        return response.text
    except Exception as e:
        print(f"Error calling Gemini generate_text: {e}")
        raise e

def get_embedding(text: str, model: str = "gemini-embedding-2") -> list[float]:
    """
    Generates text embedding vector using Gemini.
    """
    client = get_client()
    try:
        response = client.models.embed_content(
            model=model,
            contents=text,
        )
        return response.embeddings[0].values
    except Exception as e:
        print(f"Error calling Gemini get_embedding: {e}")
        raise e
