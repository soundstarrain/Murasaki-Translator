import pytest

from murasaki_translator.utils import model_config


@pytest.mark.unit
def test_model_config_identify(tmp_path):
    path = tmp_path / "Murasaki-8B-v0.2-IQ4_XS.gguf"
    path.write_text("", encoding="utf-8")
    config = model_config.identify_model(str(path))
    assert config is not None
    assert config.params == "8B"
    assert config.quant == "IQ4_XS"
    assert "v0.2" in config.display_name
    assert "Murasaki" in config.display_name


@pytest.mark.unit
def test_model_config_non_murasaki(tmp_path):
    path = tmp_path / "Foo-7B-Q4_K_M.gguf"
    path.write_text("", encoding="utf-8")
    config = model_config.identify_model(str(path))
    assert config is not None
    assert config.display_name == "Foo-7B-Q4_K_M"
