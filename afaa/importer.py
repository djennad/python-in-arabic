"""مستورِد يتيح «استورد وحدة» لملفات أفعى (.af) وحزمها."""

import importlib.abc
import importlib.machinery
import importlib.util
import os
import sys

EXTENSION = ".af"

# مكتبات أفعى القياسية المكتوبة بأفعى (مثل «واجهات»)
LIBRARY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")

__all__ = ["EXTENSION", "ArabicFinder", "ArabicLoader", "install_importer"]


class ArabicLoader(importlib.machinery.SourceFileLoader):
    """يحمّل ملف .af بعد ترجمته إلى بايثون."""

    def source_to_code(self, data, path, *, _optimize=-1):
        from .runtime import compile_arabic
        return compile_arabic(importlib.util.decode_source(data), path)

    def path_stats(self, path):
        # نعطّل التخزين المؤقت للشيفرة المجمّعة حتى تُعاد الترجمة دائمًا
        raise OSError("لا تخزين مؤقت لملفات أفعى")


class ArabicFinder(importlib.abc.MetaPathFinder):
    """يبحث عن وحدات أفعى في مسارات الاستيراد."""

    def find_spec(self, fullname, path=None, target=None):
        name = fullname.rpartition(".")[2]
        entries = [*sys.path, LIBRARY_DIR] if path is None else path
        for entry in entries:
            if not isinstance(entry, str):
                continue
            entry = entry or os.getcwd()
            if not os.path.isdir(entry):
                continue
            package_dir = os.path.join(entry, name)
            init = os.path.join(package_dir, "__init__" + EXTENSION)
            if os.path.isfile(init):
                return importlib.util.spec_from_file_location(
                    fullname, init, loader=ArabicLoader(fullname, init),
                    submodule_search_locations=[package_dir])
            module_file = os.path.join(entry, name + EXTENSION)
            if os.path.isfile(module_file):
                return importlib.util.spec_from_file_location(
                    fullname, module_file,
                    loader=ArabicLoader(fullname, module_file))
        return None


def install_importer():
    """يضيف باحث أفعى قبل PathFinder حتى لا تُعامل حزم أفعى كحزم فضاء أسماء."""
    if any(isinstance(f, ArabicFinder) for f in sys.meta_path):
        return
    position = len(sys.meta_path)
    for index, finder in enumerate(sys.meta_path):
        if finder is importlib.machinery.PathFinder:
            position = index
            break
    sys.meta_path.insert(position, ArabicFinder())
