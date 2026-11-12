"""Safe arithmetic evaluation for the Math Expression node.

The expression is typed by a user or arrives inside a shared workflow, so it
is treated as attacker-controlled: it is parsed with ``ast`` and walked
against a strict whitelist — numeric literals, the names a/b/c, arithmetic
operators, and a small set of math functions. Nothing is ever handed to
eval/exec/compile, and anything outside the whitelist is refused by name so
the error says what to remove.

All arithmetic runs in floats. That is a safety property, not a convenience:
``9 ** 9 ** 9`` over floats is an OverflowError caught below, where integer
power would happily build a number with hundreds of millions of digits.
"""

from __future__ import annotations

import ast
import math

# Longer than any honest expression and shorter than a payload. Parsing is
# linear, but there is no reason to chew on kilobytes of "input".
MAX_EXPRESSION_LENGTH = 4096

ALLOWED_VARIABLES = ("a", "b", "c")


def _power(base: float, exponent: float) -> float:
    # math.pow keeps everything in float land: a huge result raises
    # OverflowError and a negative base with a fractional exponent raises
    # ValueError, where the ** operator would return a complex number.
    try:
        return math.pow(base, exponent)
    except ValueError:
        raise ValueError(
            "Math Expression 不支持负数取分数次幂。"
        ) from None


_BINARY_OPS = {
    ast.Add: lambda x, y: x + y,
    ast.Sub: lambda x, y: x - y,
    ast.Mult: lambda x, y: x * y,
    ast.Div: lambda x, y: x / y,
    ast.FloorDiv: lambda x, y: x // y,
    ast.Mod: lambda x, y: x % y,
    ast.Pow: _power,
}

_UNARY_OPS = {
    ast.USub: lambda x: -x,
    ast.UAdd: lambda x: x,
}

# name -> (apply, minimum argument count, maximum or None for variadic)
_FUNCTIONS = {
    "min": (lambda args: min(args), 2, None),
    "max": (lambda args: max(args), 2, None),
    "abs": (lambda args: abs(args[0]), 1, 1),
    "round": (lambda args: float(round(args[0], int(args[1])) if len(args) == 2 else round(args[0])), 1, 2),
    "floor": (lambda args: float(math.floor(args[0])), 1, 1),
    "ceil": (lambda args: float(math.ceil(args[0])), 1, 1),
    "sqrt": (lambda args: math.sqrt(args[0]), 1, 1),
}


def _call(node: ast.Call, values: dict[str, float]) -> float:
    if not isinstance(node.func, ast.Name):
        raise ValueError(
            "Math Expression only calls its allowed functions by name: "
            + ", ".join(sorted(_FUNCTIONS)) + "."
        )
    name = node.func.id
    spec = _FUNCTIONS.get(name)
    if spec is None:
        raise ValueError(
            f"Math Expression does not allow the function {name!r}; allowed: "
            + ", ".join(sorted(_FUNCTIONS)) + "."
        )
    if node.keywords:
        raise ValueError(f"Math Expression 不允许给 {name}() 传关键字参数。")
    apply, minimum, maximum = spec
    # A starred argument shows up as ast.Starred inside args and falls into
    # the catch-all refusal in _evaluate, so this list is always plain values.
    args = [_evaluate(arg, values) for arg in node.args]
    if len(args) < minimum or (maximum is not None and len(args) > maximum):
        expected = f"{minimum}" if maximum == minimum else (
            f"at least {minimum}" if maximum is None else f"{minimum} to {maximum}"
        )
        raise ValueError(f"Math Expression：{name}() 需要 {expected} 个参数，实际给了 {len(args)} 个。")
    try:
        return float(apply(args))
    except ValueError:
        raise ValueError(
            f"Math Expression: {name}() cannot take these values "
            "(for example the square root of a negative number)."
        ) from None


def _evaluate(node: ast.AST, values: dict[str, float]) -> float:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ValueError(
                f"Math Expression 只允许数字，不允许 {type(node.value).__name__} 字面量。"
            )
        return float(node.value)
    if isinstance(node, ast.Name):
        if node.id not in values:
            raise ValueError(
                f"Math Expression 只认 a、b、c 这三个名字，不认 {node.id!r}。"
            )
        return values[node.id]
    if isinstance(node, ast.BinOp):
        op = _BINARY_OPS.get(type(node.op))
        if op is None:
            raise ValueError(
                f"Math Expression 不允许使用 {type(node.op).__name__} 运算符。"
            )
        return op(_evaluate(node.left, values), _evaluate(node.right, values))
    if isinstance(node, ast.UnaryOp):
        op = _UNARY_OPS.get(type(node.op))
        if op is None:
            raise ValueError(
                f"Math Expression 不允许使用 {type(node.op).__name__} 运算符。"
            )
        return op(_evaluate(node.operand, values))
    if isinstance(node, ast.Call):
        return _call(node, values)
    # Named refusals for the classic escape hatches, so the error teaches.
    if isinstance(node, ast.Attribute):
        raise ValueError("Math Expression 不允许属性访问。")
    if isinstance(node, ast.Subscript):
        raise ValueError("Math Expression 不允许下标访问。")
    raise ValueError(f"Math Expression 不允许 {type(node).__name__} 语法。")


def evaluate_expression(expression: str, variables: dict[str, float] | None = None) -> float:
    """Evaluate one arithmetic expression over the variables a, b and c.

    Missing variables default to 0.0. Raises ValueError with a message that
    names the problem for anything outside the whitelist, for division by
    zero, and for results that overflow or are not finite.
    """
    if not isinstance(expression, str):
        raise ValueError("Math Expression 需要以文本形式给出表达式。")
    text = expression.strip()
    if not text:
        raise ValueError("Math Expression 收到空表达式。")
    if len(text) > MAX_EXPRESSION_LENGTH:
        raise ValueError(
            f"Math Expression is limited to {MAX_EXPRESSION_LENGTH} characters "
            f"(got {len(text)})."
        )
    supplied = variables or {}
    values = {name: float(supplied.get(name, 0.0)) for name in ALLOWED_VARIABLES}
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError as exc:
        raise ValueError(f"Math Expression 解析失败：{exc.msg}。") from None
    except RecursionError:
        raise ValueError("Math Expression 的嵌套层级太深。") from None
    try:
        result = _evaluate(tree.body, values)
    except RecursionError:
        raise ValueError("Math Expression 的嵌套层级太深。") from None
    except ZeroDivisionError:
        raise ValueError("Math Expression 除以了零。") from None
    except OverflowError:
        raise ValueError("Math Expression 算出的数值过大，表示不了。") from None
    if not math.isfinite(result):
        raise ValueError("Math Expression 算出了非有限数值（inf 或 nan）。")
    return float(result)


def round_half_away_from_zero(value: float) -> int:
    """The INT output's rounding: 2.5 -> 3 and -2.5 -> -3.

    Python's round() rounds halves to even (2.5 -> 2), which reads as a bug
    when the number is on screen next to the float it came from.
    """
    if value >= 0:
        return int(math.floor(value + 0.5))
    return int(math.ceil(value - 0.5))


__all__ = [
    "ALLOWED_VARIABLES",
    "MAX_EXPRESSION_LENGTH",
    "evaluate_expression",
    "round_half_away_from_zero",
]
