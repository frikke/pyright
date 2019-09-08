/*
* parseTreeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility routines for traversing a parse tree.
*/

import { DiagnosticTextPosition } from '../common/diagnostic';
import { convertPositionToOffset } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { ArgumentCategory, ClassNode, ExpressionNode, FunctionNode, isExpressionNode,
    ModuleNode, ParameterCategory, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { KeywordType, OperatorType, StringTokenFlags } from '../parser/tokenizerTypes';
import { ParseTreeWalker } from './parseTreeWalker';

export enum PrintExpressionFlags {
    None = 0,

    // Don't use string literals for forward declarations.
    ForwardDeclarations = 0x01
}

export class ParseTreeUtils {
    static getNodeDepth(node: ParseNode): number {
        let depth = 0;
        let curNode: ParseNode | undefined = node;

        while (curNode) {
            depth++;
            curNode = curNode.parent;
        }

        return depth;
    }

    // Returns the deepest node that contains the specified position.
    static findNodeByPosition(node: ParseNode, position: DiagnosticTextPosition,
            lines: TextRangeCollection<TextRange>): ParseNode | undefined {

        const offset = convertPositionToOffset(position, lines);
        if (offset === undefined) {
            return undefined;
        }

        return ParseTreeUtils.findNodeByOffset(node, offset);
    }

    // Returns the deepest node that contains the specified offset.
    static findNodeByOffset(node: ParseNode, offset: number): ParseNode | undefined {
        if (offset < node.start || offset > TextRange.getEnd(node)) {
            return undefined;
        }

        const parseTreeWalker = new ParseTreeWalker();

        // The range is found within this node. See if we can localize it
        // further by checking its children.
        const children = parseTreeWalker.visitNode(node);
        for (const child of children) {
            if (child) {
                const containingChild = ParseTreeUtils.findNodeByOffset(child, offset);
                if (containingChild) {
                    return containingChild;
                }
            }
        }

        return node;
    }

    static printExpression(node: ExpressionNode, flags = PrintExpressionFlags.None): string {
        if (node.nodeType === ParseNodeType.Name) {
            return node.nameToken.value;
        } else if (node.nodeType === ParseNodeType.MemberAccess) {
            return ParseTreeUtils.printExpression(node.leftExpression, flags) + '.' +
                node.memberName.nameToken.value;
        } else if (node.nodeType === ParseNodeType.Call) {
            return ParseTreeUtils.printExpression(node.leftExpression, flags) + '(' +
                node.arguments.map(arg => {
                    let argStr = '';
                    if (arg.argumentCategory === ArgumentCategory.UnpackedList) {
                        argStr = '*';
                    } else if (arg.argumentCategory === ArgumentCategory.UnpackedDictionary) {
                        argStr = '**';
                    }
                    if (arg.name) {
                        argStr += arg.name.nameToken.value + '=';
                    }
                    argStr += this.printExpression(arg.valueExpression, flags);
                    return argStr;
                }).join(', ') +
                ')';
        } else if (node.nodeType === ParseNodeType.Index) {
            return ParseTreeUtils.printExpression(node.baseExpression, flags) + '[' +
                node.items.items.map(item => this.printExpression(item, flags)).join(', ') +
                ']';
        } else if (node.nodeType === ParseNodeType.UnaryOperation) {
            return ParseTreeUtils.printOperator(node.operator) + ' ' +
                ParseTreeUtils.printExpression(node.expression, flags);
        } else if (node.nodeType === ParseNodeType.BinaryOperation) {
            return ParseTreeUtils.printExpression(node.leftExpression, flags) + ' ' +
                ParseTreeUtils.printOperator(node.operator) + ' ' +
                ParseTreeUtils.printExpression(node.rightExpression, flags);
        } else if (node.nodeType === ParseNodeType.Number) {
            return node.token.value.toString();
        } else if (node.nodeType === ParseNodeType.StringList) {
            if ((flags & PrintExpressionFlags.ForwardDeclarations) && node.typeAnnotation) {
                return ParseTreeUtils.printExpression(node.typeAnnotation, flags);
            } else {
                return node.strings.map(str => {
                    return ParseTreeUtils.printExpression(str, flags);
                }).join(' ');
            }
        } else if (node.nodeType === ParseNodeType.String) {
            let exprString = '';
            if (node.token.flags & StringTokenFlags.Raw) {
                exprString += 'r';
            }

            if (node.token.flags & StringTokenFlags.Unicode) {
                exprString += 'u';
            }

            if (node.token.flags & StringTokenFlags.Bytes) {
                exprString += 'b';
            }

            if (node.token.flags & StringTokenFlags.Format) {
                exprString += 'f';
            }

            if (node.token.flags & StringTokenFlags.Triplicate) {
                if (node.token.flags & StringTokenFlags.SingleQuote) {
                    exprString += `'''${ node.token.escapedValue }'''`;
                } else {
                    exprString += `"""${ node.token.escapedValue }"""`;
                }
            } else {
                if (node.token.flags & StringTokenFlags.SingleQuote) {
                    exprString += `'${ node.token.escapedValue }'`;
                } else {
                    exprString += `"${ node.token.escapedValue }"`;
                }
            }

            return exprString;
        } else if (node.nodeType === ParseNodeType.Assignment) {
            return ParseTreeUtils.printExpression(node.leftExpression, flags) + ' = ' +
                ParseTreeUtils.printExpression(node.rightExpression, flags);
        } else if (node.nodeType === ParseNodeType.TypeAnnotation) {
            return ParseTreeUtils.printExpression(node.valueExpression, flags) + ': ' +
                ParseTreeUtils.printExpression(node.typeAnnotation, flags);
        } else if (node.nodeType === ParseNodeType.AugmentedAssignment) {
            return ParseTreeUtils.printExpression(node.leftExpression, flags) + ' ' +
                ParseTreeUtils.printOperator(node.operator) + ' ' +
                ParseTreeUtils.printExpression(node.rightExpression, flags);
        } else if (node.nodeType === ParseNodeType.Await) {
            return 'await ' + ParseTreeUtils.printExpression(node.expression, flags);
        } else if (node.nodeType === ParseNodeType.Ternary) {
            return ParseTreeUtils.printExpression(node.ifExpression, flags) + ' if ' +
                ParseTreeUtils.printExpression(node.testExpression, flags) + ' else ' +
                ParseTreeUtils.printExpression(node.elseExpression, flags);
        } else if (node.nodeType === ParseNodeType.List) {
            const expressions = node.entries.map(expr => {
                return ParseTreeUtils.printExpression(expr, flags);
            });
            return `[${ expressions.join(', ') }]`;
        } else if (node.nodeType === ParseNodeType.Unpack) {
            return '*' + ParseTreeUtils.printExpression(node.expression, flags);
        } else if (node.nodeType === ParseNodeType.Tuple) {
            const expressions = node.expressions.map(expr => {
                return ParseTreeUtils.printExpression(expr, flags);
            });
            if (expressions.length === 1) {
                return `(${ expressions[0] }, )`;
            }
            return `(${ expressions.join(', ') })`;
        } else if (node.nodeType === ParseNodeType.Yield) {
            return 'yield ' + ParseTreeUtils.printExpression(node.expression, flags);
        } else if (node.nodeType === ParseNodeType.YieldFrom) {
            return 'yield from ' + ParseTreeUtils.printExpression(node.expression, flags);
        } else if (node.nodeType === ParseNodeType.Ellipsis) {
            return '...';
        } else if (node.nodeType === ParseNodeType.ListComprehension) {
            let listStr = '<ListExpression>';

            if (isExpressionNode(node.expression)) {
                listStr = ParseTreeUtils.printExpression(node.expression as ExpressionNode, flags);
            } else if (node.expression.nodeType === ParseNodeType.DictionaryKeyEntry) {
                const keyStr = ParseTreeUtils.printExpression(node.expression.keyExpression, flags);
                const valueStr = ParseTreeUtils.printExpression(node.expression.valueExpression, flags);
                listStr = `${ keyStr }: ${ valueStr }`;
            }

            return listStr + ' ' +
                node.comprehensions.map(expr => {
                    if (expr.nodeType === ParseNodeType.ListComprehensionFor) {
                        return `${ expr.isAsync ? 'async ' : '' }for ` +
                            ParseTreeUtils.printExpression(expr.targetExpression, flags) +
                            ` in ${ ParseTreeUtils.printExpression(expr.iterableExpression, flags) }`;
                    } else {
                        return `if ${ ParseTreeUtils.printExpression(expr.testExpression, flags) }`;
                    }
                }).join(' ');
        } else if (node.nodeType === ParseNodeType.Slice) {
            let result = '';
            if (node.startValue) {
                result += ParseTreeUtils.printExpression(node.startValue, flags);
            }
            if (node.endValue) {
                result += ': ' + ParseTreeUtils.printExpression(node.endValue, flags);
            }
            if (node.stepValue) {
                result += ': ' + ParseTreeUtils.printExpression(node.stepValue, flags);
            }
            return result;
        } else if (node.nodeType === ParseNodeType.Lambda) {
            return 'lambda ' + node.parameters.map(param => {
                let paramStr = '';

                if (param.category === ParameterCategory.VarArgList) {
                    paramStr += '*';
                } else if (param.category === ParameterCategory.VarArgDictionary) {
                    paramStr += '**';
                }

                if (param.name) {
                    paramStr += param.name.nameToken.value;
                }

                if (param.defaultValue) {
                    paramStr += ' = ' + ParseTreeUtils.printExpression(param.defaultValue, flags);
                }
                return paramStr;
            }).join(', ') + ': ' + ParseTreeUtils.printExpression(node.expression, flags);
        } else if (node.nodeType === ParseNodeType.Constant) {
            if (node.token.keywordType === KeywordType.True) {
                return 'True';
            } else if (node.token.keywordType === KeywordType.False) {
                return 'False';
            } else if (node.token.keywordType === KeywordType.Debug) {
                return '__debug__';
            } else if (node.token.keywordType === KeywordType.None) {
                return 'None';
            }
        } else if (node.nodeType === ParseNodeType.Dictionary) {
            return `{ ${ node.entries.map(entry => {
                if (entry.nodeType === ParseNodeType.DictionaryKeyEntry) {
                    return `${ ParseTreeUtils.printExpression(entry.keyExpression, flags) }: ` +
                        `${ ParseTreeUtils.printExpression(entry.valueExpression, flags) }`;
                } else {
                    return ParseTreeUtils.printExpression(entry, flags);
                }
            })} }`;
        } else if (node.nodeType === ParseNodeType.DictionaryExpandEntry) {
            return `**${ ParseTreeUtils.printExpression(node.expandExpression, flags) }`;
        } else if (node.nodeType === ParseNodeType.Set) {
            return node.entries.map(entry => ParseTreeUtils.printExpression(entry, flags)).join(', ');
        }

        return '<Expression>';
    }

    static printOperator(operator: OperatorType): string {
        const operatorMap: { [operator: number]: string } = {
            [OperatorType.Add]: '+',
            [OperatorType.AddEqual]: '+=',
            [OperatorType.Assign]: '=',
            [OperatorType.BitwiseAnd]: '&',
            [OperatorType.BitwiseAndEqual]: '&=',
            [OperatorType.BitwiseInvert]: '~',
            [OperatorType.BitwiseOr]: '|',
            [OperatorType.BitwiseOrEqual]: '|=',
            [OperatorType.BitwiseXor]: '^',
            [OperatorType.BitwiseXorEqual]: '^=',
            [OperatorType.Divide]: '/',
            [OperatorType.DivideEqual]: '/=',
            [OperatorType.Equals]: '==',
            [OperatorType.FloorDivide]: '//',
            [OperatorType.FloorDivideEqual]: '//=',
            [OperatorType.GreaterThan]: '>',
            [OperatorType.GreaterThanOrEqual]: '>=',
            [OperatorType.LeftShift]: '<<',
            [OperatorType.LeftShiftEqual]: '<<=',
            [OperatorType.LessThan]: '<',
            [OperatorType.LessThanOrEqual]: '<=',
            [OperatorType.MatrixMultiply]: '@',
            [OperatorType.MatrixMultiplyEqual]: '@=',
            [OperatorType.Mod]: '%',
            [OperatorType.ModEqual]: '%=',
            [OperatorType.Multiply]: '*',
            [OperatorType.MultiplyEqual]: '*=',
            [OperatorType.NotEquals]: '!=',
            [OperatorType.Power]: '**',
            [OperatorType.PowerEqual]: '**=',
            [OperatorType.RightShift]: '>>',
            [OperatorType.RightShiftEqual]: '>>=',
            [OperatorType.Subtract]: '-',
            [OperatorType.SubtractEqual]: '-=',
            [OperatorType.And]: 'and',
            [OperatorType.Or]: 'or',
            [OperatorType.Not]: 'not',
            [OperatorType.Is]: 'is',
            [OperatorType.IsNot]: 'is not',
            [OperatorType.In]: 'in',
            [OperatorType.NotIn]: 'not in'
        };

        if (operatorMap[operator]) {
            return operatorMap[operator];
        }

        return 'unknown';
    }

    static getEnclosingClass(node: ParseNode, stopAtFunction = false): ClassNode | undefined {
        let curNode = node.parent;
        while (curNode) {
            if (curNode.nodeType === ParseNodeType.Class) {
                return curNode;
            }

            if (curNode.nodeType === ParseNodeType.Module) {
                return undefined;
            }

            if (curNode.nodeType === ParseNodeType.Function) {
                if (stopAtFunction) {
                    return undefined;
                }
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    static getEnclosingClassOrModule(node: ParseNode,
            stopAtFunction = false): ClassNode | ModuleNode | undefined {

        let curNode = node.parent;
        while (curNode) {
            if (curNode.nodeType === ParseNodeType.Class) {
                return curNode;
            }

            if (curNode.nodeType === ParseNodeType.Module) {
                return curNode;
            }

            if (curNode.nodeType === ParseNodeType.Function) {
                if (stopAtFunction) {
                    return undefined;
                }
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    static getEnclosingFunction(node: ParseNode): FunctionNode | undefined {
        let curNode = node.parent;
        while (curNode) {
            if (curNode.nodeType === ParseNodeType.Function) {
                return curNode;
            }

            if (curNode.nodeType === ParseNodeType.Class) {
                return undefined;
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    static isNodeContainedWithin(node: ParseNode, potentialContainer: ParseNode): boolean {
        let curNode = node.parent;
        while (curNode) {
            if (curNode === potentialContainer) {
                return true;
            }

            curNode = curNode.parent;
        }

        return false;
    }
}
