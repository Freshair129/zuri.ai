import pytest
from fastapi.testclient import TestClient
import json
import numpy as np


@pytest.fixture
def client():
    # Import the app from the sidecar module
    import sys
    import importlib.util
    # Load module from scripts/embed-sidecar.py (file with hyphen)
    spec = importlib.util.spec_from_file_location("embed_sidecar", "scripts/embed-sidecar.py")
    embed_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(embed_module)
    return TestClient(embed_module.app)


def test_health_endpoint(client):
    """GET /health returns model, revision, and dim=384"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "model" in data
    assert "revision" in data
    assert data["dim"] == 384


def test_embed_query(client):
    """POST /embed with kind='query' returns vectors with L2 norm approx 1"""
    response = client.post("/embed", json={"texts": ["a"], "kind": "query"})
    assert response.status_code == 200
    data = response.json()
    assert "vectors" in data
    assert len(data["vectors"]) == 1
    assert len(data["vectors"][0]) == 384

    # Check L2 norm is approximately 1 (normalized embeddings)
    vec = np.array(data["vectors"][0])
    norm = np.linalg.norm(vec)
    assert 0.99 < norm < 1.01, f"L2 norm is {norm}, expected ~1"


def test_embed_passage_different_from_query(client):
    """POST /embed with kind='passage' prefixes 'passage: ', producing different vectors than kind='query'"""
    response_query = client.post("/embed", json={"texts": ["a"], "kind": "query"})
    assert response_query.status_code == 200
    query_vec = response_query.json()["vectors"][0]

    response_passage = client.post("/embed", json={"texts": ["a"], "kind": "passage"})
    assert response_passage.status_code == 200
    passage_vec = response_passage.json()["vectors"][0]

    # Verify both are valid 384-dim vectors
    assert len(query_vec) == 384
    assert len(passage_vec) == 384

    # Verify they are different due to the different prefix ('query: ' vs 'passage: ')
    query_arr = np.array(query_vec)
    passage_arr = np.array(passage_vec)
    cosine_sim = np.dot(query_arr, passage_arr) / (np.linalg.norm(query_arr) * np.linalg.norm(passage_arr))
    assert cosine_sim < 0.99, f"query and passage vectors should be different (prefix applied), but cosine similarity is {cosine_sim}"


def test_embed_empty_texts(client):
    """POST /embed with empty texts returns 400"""
    response = client.post("/embed", json={"texts": [], "kind": "query"})
    assert response.status_code == 400


def test_embed_invalid_kind(client):
    """POST /embed with invalid kind returns 400"""
    response = client.post("/embed", json={"texts": ["a"], "kind": "invalid"})
    assert response.status_code == 400


def test_embed_response_has_model_and_revision(client):
    """POST /embed response includes model and revision"""
    response = client.post("/embed", json={"texts": ["test"], "kind": "query"})
    assert response.status_code == 200
    data = response.json()
    assert "model" in data
    assert "revision" in data
    assert "vectors" in data
