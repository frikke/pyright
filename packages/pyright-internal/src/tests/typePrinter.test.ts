/*
 * typePrinter.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for typePrinter module.
 */

import * as assert from 'assert';

import { printType, PrintTypeFlags } from '../analyzer/typePrinter';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionType,
    FunctionTypeFlags,
    ModuleType,
    NoneType,
    TypeVarType,
    UnboundType,
    UnknownType,
} from '../analyzer/types';
import { ParameterCategory } from '../parser/parseNodes';

function returnTypeCallback(type: FunctionType) {
    return type.details.declaredReturnType ?? UnknownType.create(/* isEllipsis */ true);
}

test('SimpleTypes', () => {
    const anyType = AnyType.create(/* isEllipsis */ false);
    assert.strictEqual(printType(anyType, PrintTypeFlags.None, returnTypeCallback), 'Any');

    const ellipsisType = AnyType.create(/* isEllipsis */ true);
    assert.strictEqual(printType(ellipsisType, PrintTypeFlags.None, returnTypeCallback), '...');

    const unknownType = UnknownType.create();
    assert.strictEqual(printType(unknownType, PrintTypeFlags.None, returnTypeCallback), 'Unknown');
    assert.strictEqual(printType(unknownType, PrintTypeFlags.PrintUnknownWithAny, returnTypeCallback), 'Any');
    assert.strictEqual(printType(unknownType, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Any');

    const unboundType = UnboundType.create();
    assert.strictEqual(printType(unboundType, PrintTypeFlags.None, returnTypeCallback), 'Unbound');
    assert.strictEqual(printType(unboundType, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Any');

    const noneInstanceType = NoneType.createInstance();
    assert.strictEqual(printType(noneInstanceType, PrintTypeFlags.None, returnTypeCallback), 'None');

    const noneInstantiableType = NoneType.createType();
    assert.strictEqual(printType(noneInstantiableType, PrintTypeFlags.None, returnTypeCallback), 'Type[None]');

    const moduleType = ModuleType.create('Test', '');
    assert.strictEqual(printType(moduleType, PrintTypeFlags.None, returnTypeCallback), 'Module("Test")');
    assert.strictEqual(printType(moduleType, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Any');
});

test('TypeVarTypes', () => {
    const typeVarType = TypeVarType.createInstance('T');
    assert.strictEqual(printType(typeVarType, PrintTypeFlags.None, returnTypeCallback), 'T');

    const paramSpecType = TypeVarType.createInstance('P');
    paramSpecType.details.isParamSpec = true;
    assert.strictEqual(printType(paramSpecType, PrintTypeFlags.None, returnTypeCallback), 'P');

    const typeVarTupleType = TypeVarType.createInstance('Ts');
    paramSpecType.details.isVariadic = true;
    assert.strictEqual(printType(typeVarTupleType, PrintTypeFlags.None, returnTypeCallback), 'Ts');
});

test('ClassTypes', () => {
    const classTypeA = ClassType.createInstantiable(
        'A',
        '',
        '',
        '',
        ClassTypeFlags.None,
        0,
        /* declaredMetaclass*/ undefined,
        /* effectiveMetaclass */ undefined
    );

    const typeVarS = TypeVarType.createInstance('S');
    const typeVarT = TypeVarType.createInstance('T');

    classTypeA.details.typeParameters.push(typeVarS, typeVarT);

    assert.strictEqual(printType(classTypeA, PrintTypeFlags.None, returnTypeCallback), 'Type[A[S, T]]');

    const instanceA = ClassType.cloneAsInstance(classTypeA);
    assert.strictEqual(printType(instanceA, PrintTypeFlags.None, returnTypeCallback), 'A[S, T]');

    const classTypeInt = ClassType.createInstantiable(
        'int',
        '',
        '',
        '',
        ClassTypeFlags.None,
        0,
        /* declaredMetaclass*/ undefined,
        /* effectiveMetaclass */ undefined
    );
    const instanceInt = ClassType.cloneAsInstance(classTypeInt);

    const specializedA = ClassType.cloneForSpecialization(
        instanceA,
        [instanceInt, instanceInt],
        /* isTypeArgumentExplicit */ true
    );

    assert.strictEqual(printType(specializedA, PrintTypeFlags.None, returnTypeCallback), 'A[int, int]');

    const unionType = combineTypes([instanceInt, specializedA, typeVarS]);
    assert.strictEqual(printType(unionType, PrintTypeFlags.None, returnTypeCallback), 'Union[int, A[int, int], S]');
    assert.strictEqual(printType(unionType, PrintTypeFlags.PEP604, returnTypeCallback), 'int | A[int, int] | S');
});

test('FunctionTypes', () => {
    const funcTypeA = FunctionType.createInstance('A', '', '', FunctionTypeFlags.None);

    FunctionType.addParameter(funcTypeA, {
        category: ParameterCategory.Simple,
        hasDeclaredType: true,
        type: NoneType.createInstance(),
        name: 'a',
    });

    FunctionType.addParameter(funcTypeA, {
        category: ParameterCategory.Simple,
        hasDeclaredType: true,
        type: AnyType.create(),
    });

    FunctionType.addParameter(funcTypeA, {
        category: ParameterCategory.VarArgList,
        hasDeclaredType: true,
        type: AnyType.create(),
        name: 'args',
    });

    FunctionType.addParameter(funcTypeA, {
        category: ParameterCategory.VarArgDictionary,
        hasDeclaredType: true,
        type: AnyType.create(),
        name: 'kwargs',
    });

    funcTypeA.details.declaredReturnType = NoneType.createInstance();

    assert.strictEqual(
        printType(funcTypeA, PrintTypeFlags.None, returnTypeCallback),
        '(a: None, /, *args: Any, **kwargs: Any) -> None'
    );
    assert.strictEqual(printType(funcTypeA, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Callable[..., None]');

    const funcTypeB = FunctionType.createInstance('B', '', '', FunctionTypeFlags.None);

    FunctionType.addParameter(funcTypeB, {
        category: ParameterCategory.Simple,
        hasDeclaredType: true,
        type: NoneType.createInstance(),
        name: 'a',
    });

    FunctionType.addParameter(funcTypeB, {
        category: ParameterCategory.Simple,
        hasDeclaredType: true,
        type: NoneType.createInstance(),
    });

    const paramSpecP = TypeVarType.createInstance('P');
    paramSpecP.details.isParamSpec = true;
    funcTypeB.details.paramSpec = paramSpecP;

    funcTypeB.details.declaredReturnType = NoneType.createInstance();

    assert.strictEqual(printType(funcTypeB, PrintTypeFlags.None, returnTypeCallback), '(a: None, /, **P) -> None');
    assert.strictEqual(
        printType(funcTypeB, PrintTypeFlags.PythonSyntax, returnTypeCallback),
        'Callable[Concatenate[None, P], None]'
    );

    const funcTypeC = FunctionType.createInstance('C', '', '', FunctionTypeFlags.None);

    const typeVarTupleTs = TypeVarType.createInstance('Ts');
    typeVarTupleTs.details.isVariadic = true;
    const unpackedTs = TypeVarType.cloneForUnpacked(typeVarTupleTs);

    FunctionType.addParameter(funcTypeC, {
        category: ParameterCategory.VarArgList,
        hasDeclaredType: true,
        type: unpackedTs,
        name: 'args',
    });

    assert.strictEqual(printType(funcTypeC, PrintTypeFlags.None, returnTypeCallback), '(*args: *Ts) -> Unknown');
    assert.strictEqual(
        printType(funcTypeC, PrintTypeFlags.UseTypingUnpack, returnTypeCallback),
        '(*args: Unpack[Ts]) -> Unknown'
    );
    assert.strictEqual(printType(funcTypeC, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Callable[..., Any]');
});